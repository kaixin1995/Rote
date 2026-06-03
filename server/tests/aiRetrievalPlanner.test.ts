import { describe, expect, it } from 'bun:test';
import {
  canonicalizeSearchRotesArgs,
  canonicalizeTimeRange,
  createRetrievalPlan,
  lifecycleScopeToArchived,
  toPlannerAgentDto,
  type RetrievalScope,
  type SearchRotesProbeExecutor,
} from '../utils/ai/retrievalPlan';
import type { AiConfig } from '../types/config';
import type { ChatMessage, ChatToolCall, ChatToolDefinition } from '../utils/ai/client';

const AVAILABLE_TAGS = ['工作', '生活', '开心'];

const config: AiConfig = {
  enabled: true,
  vectorEnabled: true,
  autoIndexEnabled: true,
  publicExploreVectorEnabled: false,
  chat: { providerId: 'test', baseUrl: 'http://test', model: 'test-chat' },
  embedding: { providerId: 'test', baseUrl: 'http://test', model: 'test-embedding', dimensions: 3 },
  indexing: { chunkSize: 800, chunkOverlap: 100, batchSize: 10, maxRetries: 1 },
};

function toolCall(name: string, args: unknown, id = `call_${name}`): ChatToolCall {
  return {
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  };
}

function completionSequence(calls: ChatToolCall[][]) {
  let index = 0;
  return async (
    _config: any,
    _messages: ChatMessage[],
    _tools: ChatToolDefinition[]
  ): Promise<{ message: ChatMessage; usage: undefined }> => ({
    message: {
      role: 'assistant',
      content: null,
      tool_calls: calls[index++] || [],
    },
    usage: undefined,
  });
}

function probe(): SearchRotesProbeExecutor {
  return async (scope: RetrievalScope) => ({
    sources: [
      {
        sourceType: 'rote',
        sourceId: 'r1',
        text: 'A matching note',
        similarity: 0.9,
        metadata: { tags: scope.tags },
      },
    ],
    toolResult: {
      canonicalizedArgs: scope,
      resultCount: 1,
      topSnippets: [
        {
          id: 'rote:r1',
          sourceType: 'rote',
          sourceId: 'r1',
          similarity: 0.9,
          text: 'A matching note',
          tags: scope.tags,
        },
      ],
      cursor: null,
      warnings: [],
    },
  });
}

describe('canonicalizeSearchRotesArgs', () => {
  it('downgrades unknown tags into semanticScope', () => {
    const { scope, warnings } = canonicalizeSearchRotesArgs({
      ownerId: 'u1',
      availableTags: AVAILABLE_TAGS,
      args: { tags: ['工作', '不存在'], excludeTags: ['生活', '未知'] },
    });

    expect(scope.tags).toEqual(['工作']);
    expect(scope.excludeTags).toEqual(['生活']);
    expect(scope.semanticScope).toContain('不存在');
    expect(scope.semanticScope).toContain('未知');
    expect(warnings).toContain('unknown_tag_downgraded:不存在');
    expect(warnings).toContain('unknown_exclude_tag_downgraded:未知');
  });

  it('keeps lifecycleScope and taskStatusScope independent', () => {
    const { scope } = canonicalizeSearchRotesArgs({
      ownerId: 'u1',
      availableTags: AVAILABLE_TAGS,
      args: { lifecycleScope: 'archived', taskStatusScope: 'open' },
    });

    expect(scope.lifecycleScope).toBe('archived');
    expect(scope.taskStatusScope).toBe('open');
    expect(lifecycleScopeToArchived(scope.lifecycleScope)).toBe(true);
  });

  it('canonicalizes time ranges', () => {
    expect(canonicalizeTimeRange({ from: '2026-01-01', to: '2026-01-03' })).toMatchObject({
      from: '2026-01-01T00:00:00+08:00',
      to: '2026-01-03T23:59:59+08:00',
    });
    expect(canonicalizeTimeRange({ timeExpression: '今天' })?.label).toBe('今天');
    expect(canonicalizeTimeRange({ timeExpression: '最近7天' })?.label).toBe('最近7天');
  });

  it('clamps limit and validates sourceTypes', () => {
    const { scope, warnings } = canonicalizeSearchRotesArgs({
      ownerId: 'u1',
      availableTags: AVAILABLE_TAGS,
      args: { limit: 999, sourceTypes: ['rote', 'bad' as any] },
    });

    expect(scope.limit).toBe(50);
    expect(scope.sourceTypes).toEqual(['rote']);
    expect(warnings).toContain('invalid_source_type:bad');
  });

  it('carries excludeIds into canonical scope', () => {
    const { scope } = canonicalizeSearchRotesArgs({
      ownerId: 'u1',
      availableTags: AVAILABLE_TAGS,
      args: { query: '继续查' },
      excludeIds: ['rote:r1'],
    });

    expect(scope.excludeIds).toEqual(['rote:r1']);
  });
});

describe('createRetrievalPlan tool loop', () => {
  it('finishes without retrieval', async () => {
    const result = await createRetrievalPlan({
      ownerId: 'u1',
      message: '谢谢',
      config,
      availableTags: AVAILABLE_TAGS,
      executeSearch: probe(),
      completeWithTools: completionSequence([
        [toolCall('finish', { retrievalNeeded: false, reason: 'chat_only' })],
      ]),
    });

    expect(result.retrievalNeeded).toBe(false);
    expect(result.debugTrace.finishReason).toBe('chat_only');
  });

  it('runs a single search then finishes', async () => {
    const result = await createRetrievalPlan({
      ownerId: 'u1',
      message: '找工作笔记',
      config,
      availableTags: AVAILABLE_TAGS,
      executeSearch: probe(),
      completeWithTools: completionSequence([
        [toolCall('search_rotes', { query: '工作', tags: ['工作'] })],
        [toolCall('finish', { useLastSearch: true, reason: 'enough' })],
      ]),
    });

    expect(result.retrievalNeeded).toBe(true);
    expect(result.scope?.query).toBe('工作');
    expect(result.scope?.tags).toEqual(['工作']);
    expect(result.toolResult?.resultCount).toBe(1);
  });

  it('does not include raw sources in the public DTO', async () => {
    const result = await createRetrievalPlan({
      ownerId: 'u1',
      message: '找工作笔记',
      config,
      availableTags: AVAILABLE_TAGS,
      executeSearch: probe(),
      completeWithTools: completionSequence([
        [toolCall('search_rotes', { query: '工作', tags: ['工作'] })],
        [toolCall('finish', { useLastSearch: true, reason: 'enough' })],
      ]),
    });
    const dto = toPlannerAgentDto(result);

    expect('sources' in dto).toBe(false);
    expect(dto.toolResult?.topSnippets[0]?.text).toBe('A matching note');
  });

  it('surfaces probe failures instead of converting them to no-retrieval', async () => {
    await expect(
      createRetrievalPlan({
        ownerId: 'u1',
        message: '找工作笔记',
        config,
        availableTags: AVAILABLE_TAGS,
        executeSearch: async () => {
          throw new Error('vector unavailable');
        },
        completeWithTools: completionSequence([
          [toolCall('search_rotes', { query: '工作', tags: ['工作'] })],
        ]),
      })
    ).rejects.toThrow('vector unavailable');
  });

  it('can list tags before searching', async () => {
    const result = await createRetrievalPlan({
      ownerId: 'u1',
      message: '按准确标签查',
      config,
      availableTags: AVAILABLE_TAGS,
      getTagCounts: async () => [{ name: '工作', count: 3 }],
      executeSearch: probe(),
      completeWithTools: completionSequence([
        [toolCall('list_tags', { limit: 5 })],
        [toolCall('search_rotes', { query: '', tags: ['工作'] })],
        [toolCall('finish', { useLastSearch: true, reason: 'tag_checked' })],
      ]),
    });

    expect(result.debugTrace.toolCalls.map((call) => call.name)).toEqual([
      'list_tags',
      'search_rotes',
      'finish',
    ]);
    expect(result.scope?.tags).toEqual(['工作']);
  });

  it('uses the last search after multiple searches', async () => {
    const result = await createRetrievalPlan({
      ownerId: 'u1',
      message: '多查几次',
      config,
      availableTags: AVAILABLE_TAGS,
      executeSearch: probe(),
      completeWithTools: completionSequence([
        [toolCall('search_rotes', { query: 'first', tags: ['工作'] })],
        [toolCall('search_rotes', { query: 'second', tags: ['生活'] })],
        [toolCall('finish', { useLastSearch: true, reason: 'use_latest' })],
      ]),
    });

    expect(result.scope?.query).toBe('second');
    expect(result.scope?.tags).toEqual(['生活']);
    expect(result.debugTrace.canonicalizedArgs).toHaveLength(2);
  });

  it('requests clarification', async () => {
    const result = await createRetrievalPlan({
      ownerId: 'u1',
      message: '那件事',
      config,
      availableTags: AVAILABLE_TAGS,
      executeSearch: probe(),
      completeWithTools: completionSequence([
        [toolCall('request_clarification', { question: '你想查哪件事？', reason: 'ambiguous' })],
      ]),
    });

    expect(result.retrievalNeeded).toBe(false);
    expect(result.clarification?.question).toBe('你想查哪件事？');
  });
});
