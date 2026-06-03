import type { AiProviderConfig } from '../../types/config';

export type ChatToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ChatToolCall[];
};

export type ChatToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ChatCompletionOptions = {
  temperature?: number;
  enableThinking?: boolean;
};

export type ChatCompletionUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

export type ChatCompletionStreamPart =
  | { type: 'content' | 'reasoning'; text: string }
  | {
      type: 'usage';
      usage: ChatCompletionUsage;
    };

function toTokenCount(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
}

function normalizeUsage(usage: any, fallbackCompletionTokens = 0): ChatCompletionUsage | undefined {
  if (!usage || typeof usage !== 'object') return undefined;

  const promptTokens = toTokenCount(
    usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokens ?? usage.inputTokens
  );
  const completionTokens = toTokenCount(
    usage.completion_tokens ??
      usage.output_tokens ??
      usage.completionTokens ??
      usage.outputTokens ??
      fallbackCompletionTokens
  );
  const explicitTotalTokens = toTokenCount(usage.total_tokens ?? usage.totalTokens);
  const totalTokens = explicitTotalTokens || promptTokens + completionTokens;

  if (totalTokens === 0) return undefined;

  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
  };
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function normalizeToolCalls(value: unknown): ChatToolCall[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const toolCalls = value
    .filter(
      (call: any) =>
        typeof call?.id === 'string' &&
        call?.type === 'function' &&
        typeof call?.function?.name === 'string'
    )
    .map((call: any) => ({
      id: call.id,
      type: 'function' as const,
      function: {
        name: call.function.name,
        arguments: typeof call.function.arguments === 'string' ? call.function.arguments : '{}',
      },
    }));
  return toolCalls.length ? toolCalls : undefined;
}

function buildHeaders(config: AiProviderConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }
  return headers;
}

async function readJsonResponse(response: Response): Promise<any> {
  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    const message =
      body?.error?.message ||
      body?.message ||
      (typeof body === 'string' && body) ||
      `Provider request failed with ${response.status}`;
    throw new Error(message);
  }

  return body;
}

function ensureProviderConfig(config: AiProviderConfig): void {
  if (!config.baseUrl?.trim()) {
    throw new Error('Provider base URL is required');
  }
  if (!config.model?.trim()) {
    throw new Error('Provider model is required');
  }
}

function buildChatRequestBody(
  config: AiProviderConfig,
  body: {
    messages: ChatMessage[];
    temperature: number;
    stream?: boolean;
    enableThinking?: boolean;
    tools?: ChatToolDefinition[];
    toolChoice?: 'auto' | 'none';
  }
): Record<string, unknown> {
  return {
    model: config.model,
    messages: body.messages,
    temperature: body.temperature,
    ...(body.stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    ...(body.tools?.length ? { tools: body.tools, tool_choice: body.toolChoice || 'auto' } : {}),
    ...(config.providerId === 'dashscope' && typeof body.enableThinking === 'boolean'
      ? { enable_thinking: body.enableThinking }
      : {}),
  };
}

export async function createEmbedding(
  config: AiProviderConfig & { dimensions?: number },
  input: string
): Promise<{
  embedding: number[];
  usage?: { prompt_tokens: number; total_tokens: number };
}> {
  ensureProviderConfig(config);

  const payload: any = {
    model: config.model,
    input: input.replace(/\s+/g, ' ').trim(),
  };

  if (config.dimensions && config.dimensions > 0) {
    payload.dimensions = config.dimensions;
  }

  const response = await fetch(`${normalizeBaseUrl(config.baseUrl)}/embeddings`, {
    method: 'POST',
    headers: buildHeaders(config),
    body: JSON.stringify(payload),
  });
  const body = await readJsonResponse(response);
  const embedding = body?.data?.[0]?.embedding;

  if (!Array.isArray(embedding) || embedding.some((value) => typeof value !== 'number')) {
    throw new Error('Embedding provider returned an invalid embedding response');
  }

  return {
    embedding,
    usage: normalizeUsage(body?.usage),
  };
}

export async function createChatCompletion(
  config: AiProviderConfig,
  messages: ChatMessage[],
  options: ChatCompletionOptions = {}
): Promise<{
  content: string;
  usage?: ChatCompletionUsage;
}> {
  ensureProviderConfig(config);

  const response = await fetch(`${normalizeBaseUrl(config.baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: buildHeaders(config),
    body: JSON.stringify(
      buildChatRequestBody(config, {
        messages,
        temperature: options.temperature ?? 0.2,
        enableThinking: options.enableThinking,
      })
    ),
  });
  const body = await readJsonResponse(response);
  const content = body?.choices?.[0]?.message?.content;

  if (typeof content !== 'string') {
    throw new Error('Chat provider returned an invalid chat completion response');
  }

  return {
    content,
    usage: normalizeUsage(body?.usage),
  };
}

export async function createChatCompletionWithTools(
  config: AiProviderConfig,
  messages: ChatMessage[],
  tools: ChatToolDefinition[],
  options: ChatCompletionOptions = {}
): Promise<{
  message: ChatMessage;
  usage?: ChatCompletionUsage;
}> {
  ensureProviderConfig(config);

  const response = await fetch(`${normalizeBaseUrl(config.baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: buildHeaders(config),
    body: JSON.stringify(
      buildChatRequestBody(config, {
        messages,
        tools,
        toolChoice: 'auto',
        temperature: options.temperature ?? 0.2,
        enableThinking: options.enableThinking,
      })
    ),
  });
  const body = await readJsonResponse(response);
  const message = body?.choices?.[0]?.message;

  if (!message || typeof message !== 'object') {
    throw new Error('Chat provider returned an invalid tool completion response');
  }

  return {
    message: {
      role: 'assistant',
      content: typeof message.content === 'string' ? message.content : null,
      tool_calls: normalizeToolCalls(message.tool_calls),
    },
    usage: normalizeUsage(body?.usage),
  };
}

export async function createChatCompletionWithToolsStreaming(
  config: AiProviderConfig,
  messages: ChatMessage[],
  tools: ChatToolDefinition[],
  options: ChatCompletionOptions & {
    onReasoning?: (text: string) => Promise<void> | void;
    onContent?: (text: string) => Promise<void> | void;
  } = {}
): Promise<{
  message: ChatMessage;
  usage?: ChatCompletionUsage;
}> {
  ensureProviderConfig(config);

  const response = await fetch(`${normalizeBaseUrl(config.baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: buildHeaders(config),
    body: JSON.stringify(
      buildChatRequestBody(config, {
        messages,
        tools,
        toolChoice: 'auto',
        temperature: options.temperature ?? 0.2,
        stream: true,
        enableThinking: options.enableThinking,
      })
    ),
  });

  if (!response.ok) {
    await readJsonResponse(response);
  }

  if (!response.body) {
    throw new Error('Chat provider returned an empty tool stream response');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const toolCallsByIndex = new Map<number, ChatToolCall>();
  let buffer = '';
  let content = '';
  let usage: ChatCompletionUsage | undefined;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':') || !trimmed.startsWith('data:')) continue;

        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') {
          return {
            message: {
              role: 'assistant',
              content: content || null,
              tool_calls: normalizeToolCalls(Array.from(toolCallsByIndex.values())),
            },
            usage,
          };
        }

        let chunk: any;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }

        const delta = chunk?.choices?.[0]?.delta || {};
        const reasoning = delta.reasoning_content || delta.reasoning;
        if (typeof reasoning === 'string' && reasoning.length > 0) {
          await options.onReasoning?.(reasoning);
        }

        if (typeof delta.content === 'string' && delta.content.length > 0) {
          content += delta.content;
          await options.onContent?.(delta.content);
        }

        if (Array.isArray(delta.tool_calls)) {
          for (const deltaCall of delta.tool_calls) {
            const index = Number.isInteger(deltaCall?.index)
              ? deltaCall.index
              : toolCallsByIndex.size;
            const existing =
              toolCallsByIndex.get(index) ||
              ({
                id: typeof deltaCall?.id === 'string' ? deltaCall.id : `call_${index}`,
                type: 'function',
                function: { name: '', arguments: '' },
              } satisfies ChatToolCall);

            if (typeof deltaCall?.id === 'string') existing.id = deltaCall.id;
            if (typeof deltaCall?.function?.name === 'string') {
              existing.function.name = deltaCall.function.name;
            }
            if (typeof deltaCall?.function?.arguments === 'string') {
              existing.function.arguments += deltaCall.function.arguments;
            }
            toolCallsByIndex.set(index, existing);
          }
        }

        const chunkUsage = normalizeUsage(chunk?.usage);
        if (chunkUsage) usage = chunkUsage;
      }
    }
  } finally {
    reader.releaseLock();
  }

  return {
    message: {
      role: 'assistant',
      content: content || null,
      tool_calls: normalizeToolCalls(Array.from(toolCallsByIndex.values())),
    },
    usage,
  };
}

export async function* createChatCompletionStreamParts(
  config: AiProviderConfig,
  messages: ChatMessage[],
  options: ChatCompletionOptions = {}
): AsyncGenerator<ChatCompletionStreamPart> {
  ensureProviderConfig(config);

  const response = await fetch(`${normalizeBaseUrl(config.baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: buildHeaders(config),
    body: JSON.stringify(
      buildChatRequestBody(config, {
        messages,
        temperature: options.temperature ?? 0.2,
        stream: true,
        enableThinking: options.enableThinking,
      })
    ),
  });

  if (!response.ok) {
    await readJsonResponse(response);
  }

  if (!response.body) {
    throw new Error('Chat provider returned an empty stream response');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':') || !trimmed.startsWith('data:')) continue;

        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') return;

        let chunk: any;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }

        const delta = chunk?.choices?.[0]?.delta || {};
        const reasoning = delta.reasoning_content || delta.reasoning;
        if (typeof reasoning === 'string' && reasoning.length > 0) {
          yield { type: 'reasoning', text: reasoning };
        }

        const content = delta.content;
        if (typeof content === 'string' && content.length > 0) {
          yield { type: 'content', text: content };
        }

        const usage = normalizeUsage(chunk?.usage);
        if (usage) {
          yield {
            type: 'usage',
            usage,
          };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function* createChatCompletionStream(
  config: AiProviderConfig,
  messages: ChatMessage[],
  options: ChatCompletionOptions = {}
): AsyncGenerator<string> {
  for await (const part of createChatCompletionStreamParts(config, messages, options)) {
    if (part.type === 'content') {
      yield part.text;
    }
  }
}

export async function testChatProvider(config: AiProviderConfig): Promise<void> {
  await createChatCompletion(config, [
    { role: 'system', content: 'You are a connectivity test endpoint.' },
    { role: 'user', content: 'Reply with OK.' },
  ]);
}

export async function testEmbeddingProvider(
  config: AiProviderConfig,
  expectedDimensions?: number
): Promise<{ dimensions: number }> {
  const { embedding } = await createEmbedding(config, 'Rote embedding connectivity test.');
  if (expectedDimensions && embedding.length !== expectedDimensions) {
    throw new Error(
      `Embedding dimensions mismatch: expected ${expectedDimensions}, got ${embedding.length}`
    );
  }
  return { dimensions: embedding.length };
}

export function vectorToLiteral(vector: number[]): string {
  return `[${vector.map((value) => Number(value).toString()).join(',')}]`;
}
