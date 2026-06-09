import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamLocalChatCompletion, testLocalAiConnection } from '@/utils/localAi';

const config = {
  enabled: true,
  baseUrl: 'http://127.0.0.1:11435/v1/',
  model: 'gemma-local',
  apiKey: 'local-token',
  temperature: 0.2,
};

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
  vi.unstubAllGlobals();
});

describe('local AI client', () => {
  it('tests the bridge with the local token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await testLocalAiConnection(config);

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:11435/v1/models', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer local-token',
      },
    });
  });

  it('parses streamed content, tool calls, and usage', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        { choices: [{ delta: { content: 'Hello ' } }] },
        {
          choices: [
            {
              delta: {
                content: 'Rote',
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_1',
                    function: { name: 'rote_get_tags', arguments: '{"limit":' },
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
                tool_calls: [{ index: 0, function: { arguments: '5}' } }],
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
        },
      ])
    );
    vi.stubGlobal('fetch', fetchMock);
    const chunks: string[] = [];

    const result = await streamLocalChatCompletion({
      config,
      messages: [{ role: 'user', content: 'Hello' }],
      onContent: (text) => chunks.push(text),
    });

    expect(chunks).toEqual(['Hello ', 'Rote']);
    expect(result.message.content).toBe('Hello Rote');
    expect(result.message.tool_calls?.[0]).toMatchObject({
      id: 'call_1',
      function: { name: 'rote_get_tags', arguments: '{"limit":5}' },
    });
    expect(result.usage?.total_tokens).toBe(14);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      chat_template_kwargs: { enable_thinking: false },
    });
  });

  it(`can enable model thinking for local browser calls`, async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([{ choices: [{ delta: {} }] }]));
    vi.stubGlobal('fetch', fetchMock);

    await streamLocalChatCompletion({
      config,
      messages: [{ role: 'user', content: 'Think' }],
      enableThinking: true,
    });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      chat_template_kwargs: { enable_thinking: true },
    });
  });
});
