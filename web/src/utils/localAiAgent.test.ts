import { beforeEach, describe, expect, it, vi } from 'vitest';
import { localAiAgentStream } from '@/utils/localAiAgent';

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  bootstrap: vi.fn(),
  executeTool: vi.fn(),
}));

vi.mock('@/utils/localAi', () => ({
  streamLocalChatCompletion: mocks.complete,
}));

vi.mock('@/utils/aiApi', () => ({
  getClientAgentBootstrap: mocks.bootstrap,
  executeClientAgentTool: mocks.executeTool,
}));

const config = {
  enabled: true,
  baseUrl: 'http://127.0.0.1:11435/v1',
  model: 'gemma-local',
  apiKey: 'token',
  temperature: 0.2,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('local AI agent', () => {
  it('keeps ordinary local chat independent from Rote tools', async () => {
    mocks.complete.mockImplementation(async ({ onContent }) => {
      onContent?.('private reply');
      return { message: { role: 'assistant', content: 'private reply' } };
    });
    const onDelta = vi.fn();

    await localAiAgentStream({
      config,
      payload: { message: 'hello' },
      handlers: { onDelta },
      toolsAvailable: false,
    });

    expect(onDelta).toHaveBeenCalledWith('private reply');
    expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({ enableThinking: true }));
    expect(mocks.bootstrap).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });

  it('executes an authenticated Rote tool only when tools are available', async () => {
    mocks.bootstrap.mockResolvedValue({
      systemPrompt: 'Rote agent',
      finalAnswerInstruction: 'Answer now',
      tools: [
        {
          type: 'function',
          function: { name: 'rote_get_tags', description: 'tags', parameters: {} },
        },
      ],
      policy: { maxIterations: 2, maxToolCalls: 2, maxSources: 20 },
    });
    mocks.complete
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'rote_get_tags', arguments: '{}' },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: 'final answer', tool_calls: [] },
      });
    mocks.executeTool.mockResolvedValue({
      observations: ['Loaded tags'],
      modelContent: '{"tags":[]}',
      sources: [],
      state: { stateVersion: 1, seenSourceIds: [] },
      sourceKeys: [],
    });
    const onDelta = vi.fn();

    await localAiAgentStream({
      config,
      payload: { message: 'show tags' },
      handlers: { onDelta },
      toolsAvailable: true,
    });

    expect(mocks.executeTool).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'rote_get_tags', arguments: {} })
    );
    expect(onDelta).toHaveBeenCalledWith('final answer');
  });
});
