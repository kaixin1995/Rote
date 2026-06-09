import type { PersonalAiProviderConfig } from '@/state/localAi';
import type { AiTokenUsage } from '@/utils/aiApi';

export type LocalChatToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

export type LocalChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: LocalChatToolCall[];
};

export type LocalChatToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, '');
}

function buildHeaders(config: PersonalAiProviderConfig) {
  return {
    'Content-Type': 'application/json',
    ...(config.apiKey.trim() ? { Authorization: `Bearer ${config.apiKey.trim()}` } : {}),
  };
}

async function readError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const body = JSON.parse(text);
    return (
      body?.error?.message || body?.message || `Personal model request failed (${response.status})`
    );
  } catch {
    return text || `Personal model request failed (${response.status})`;
  }
}

function tokenCount(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function normalizeUsage(value: any): AiTokenUsage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const promptTokens = tokenCount(value.prompt_tokens ?? value.promptTokens);
  const completionTokens = tokenCount(value.completion_tokens ?? value.completionTokens);
  const totalTokens =
    tokenCount(value.total_tokens ?? value.totalTokens) || promptTokens + completionTokens;
  if (!totalTokens) return undefined;
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
  };
}

function parseToolCallArguments(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return JSON.stringify(value);
  return '{}';
}

export async function testLocalAiConnection(config: PersonalAiProviderConfig): Promise<void> {
  const response = await fetch(`${normalizeBaseUrl(config.baseUrl)}/models`, {
    headers: buildHeaders(config),
  });
  if (!response.ok) throw new Error(await readError(response));
}

export async function streamLocalChatCompletion(params: {
  config: PersonalAiProviderConfig;
  messages: LocalChatMessage[];
  tools?: LocalChatToolDefinition[];
  signal?: AbortSignal;
  onReasoning?: (text: string) => void;
  onContent?: (text: string) => void;
}): Promise<{ message: LocalChatMessage; usage?: AiTokenUsage }> {
  const response = await fetch(`${normalizeBaseUrl(params.config.baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: buildHeaders(params.config),
    body: JSON.stringify({
      model: params.config.model,
      messages: params.messages,
      temperature: params.config.temperature,
      stream: true,
      stream_options: { include_usage: true },
      chat_template_kwargs: { enable_thinking: false },
      ...(params.tools?.length ? { tools: params.tools, tool_choice: 'auto' } : {}),
    }),
    signal: params.signal,
  });
  if (!response.ok) throw new Error(await readError(response));
  if (!response.body) throw new Error(`Personal model returned an empty stream`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const toolCalls = new Map<number, LocalChatToolCall>();
  let buffer = '';
  let content = '';
  let usage: AiTokenUsage | undefined;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === '[DONE]') continue;

        let chunk: any;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }

        const delta = chunk?.choices?.[0]?.delta || {};
        const reasoning = delta.reasoning_content || delta.reasoning;
        if (typeof reasoning === 'string' && reasoning) params.onReasoning?.(reasoning);
        if (typeof delta.content === 'string' && delta.content) {
          content += delta.content;
          params.onContent?.(delta.content);
        }

        if (Array.isArray(delta.tool_calls)) {
          delta.tool_calls.forEach((raw: any) => {
            const index = Number.isInteger(raw?.index) ? raw.index : toolCalls.size;
            const existing =
              toolCalls.get(index) ||
              ({
                id: typeof raw?.id === 'string' ? raw.id : `local_call_${index}`,
                type: 'function',
                function: { name: '', arguments: '' },
              } satisfies LocalChatToolCall);
            if (typeof raw?.id === 'string') existing.id = raw.id;
            if (typeof raw?.function?.name === 'string')
              existing.function.name += raw.function.name;
            if (raw?.function?.arguments !== undefined) {
              existing.function.arguments += parseToolCallArguments(raw.function.arguments);
            }
            toolCalls.set(index, existing);
          });
        }

        usage = normalizeUsage(chunk?.usage) || usage;
      }
    }
  } finally {
    reader.releaseLock();
  }

  return {
    message: {
      role: 'assistant',
      content: content || null,
      tool_calls: Array.from(toolCalls.values()).filter((call) => call.function.name),
    },
    usage,
  };
}
