import type { AiProviderConfig } from '../../types/config';

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
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

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
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
  }
): Record<string, unknown> {
  return {
    model: config.model,
    messages: body.messages,
    temperature: body.temperature,
    ...(body.stream ? { stream: true, stream_options: { include_usage: true } } : {}),
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
    usage: body?.usage
      ? {
          prompt_tokens: body.usage.prompt_tokens || 0,
          total_tokens: body.usage.total_tokens || 0,
        }
      : undefined,
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
    usage: body?.usage
      ? {
          prompt_tokens: body.usage.prompt_tokens || 0,
          completion_tokens: body.usage.completion_tokens || 0,
          total_tokens: body.usage.total_tokens || 0,
        }
      : undefined,
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

        if (chunk?.usage) {
          yield {
            type: 'usage',
            usage: {
              prompt_tokens: chunk.usage.prompt_tokens || 0,
              completion_tokens: chunk.usage.completion_tokens || 0,
              total_tokens: chunk.usage.total_tokens || 0,
            },
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
