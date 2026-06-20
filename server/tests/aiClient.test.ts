import { afterEach, describe, expect, it } from 'bun:test';
import {
  createChatCompletionWithToolsStreaming,
  probeChatProviderToolCalling,
  type ChatToolDefinition,
} from '../utils/ai/client';
import type { AiProviderConfig } from '../types/config';

const originalFetch = globalThis.fetch;

const config: AiProviderConfig = {
  providerId: 'test',
  baseUrl: 'http://test.local/v1',
  model: 'test-chat',
  apiKey: 'token',
};

const tools: ChatToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'search_rotes',
      description: 'search',
      parameters: {},
    },
  },
];

function sseResponse(events: unknown[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        events.forEach((event) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        );
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
  );
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('ai client streaming', () => {
  it('appends chunked streamed tool function names', async () => {
    globalThis.fetch = (async () =>
      sseResponse([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_1',
                    function: { name: 'search_', arguments: '{"query":"' },
                  },
                ],
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: { name: 'rotes', arguments: 'work"}' },
                  },
                ],
              },
            },
          ],
        },
      ])) as typeof fetch;

    const result = await createChatCompletionWithToolsStreaming(
      config,
      [{ role: 'user', content: 'search' }],
      tools
    );

    expect(result.message.tool_calls?.[0]).toMatchObject({
      id: 'call_1',
      function: {
        name: 'search_rotes',
        arguments: '{"query":"work"}',
      },
    });
  });

  it('uses auto tool choice for tool calling probes', async () => {
    let requestBody: any;
    globalThis.fetch = (async (_url, init) => {
      requestBody = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    id: 'call_probe',
                    type: 'function',
                    function: {
                      name: 'rote_tool_calling_probe',
                      arguments: '{"token":"rote-tool-probe"}',
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const result = await probeChatProviderToolCalling(config);

    expect(result.supported).toBe(true);
    expect(requestBody.tool_choice).toBe('auto');
  });
});
