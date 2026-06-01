import { describe, expect, it } from 'bun:test';
import {
  hasComplexModifiers,
  createFastRetrievalPlan,
  sanitizePlannerOutput,
  reducePlan,
  mergePlan,
  buildNewSearchPlan,
  fallbackPlan,
  type PlannerOutput,
  type AiRetrievalPlan,
} from '../utils/ai/retrievalPlan';
import { sanitizePreviousPlan, sanitizeExcludeIds } from '../utils/dbMethods/ai';

const AVAILABLE_TAGS = ['大喜', '大悲', '工作', '生活', '技术', '植物', '开心'];

function makePreviousPlan(overrides?: Partial<AiRetrievalPlan>): AiRetrievalPlan {
  return {
    originalMessage: '最近开心的事',
    operations: ['summarize'],
    query: '开心的事',
    filters: {
      time: null,
      tags: { include: [], exclude: [], match: 'any', unresolved: [], confidence: 1 },
      semanticScope: [],
      sourceTypes: ['rote', 'article'],
      state: 'all',
      archived: null,
    },
    comparison: null,
    confidence: 0.9,
    needsClarification: false,
    clarificationQuestion: null,
    retrievalNeeded: true,
    pagination: null,
    ...overrides,
  };
}

// ─── hasComplexModifiers ────────────────────────────────────────────────────

describe('hasComplexModifiers', () => {
  it('returns false for plain messages', () => {
    expect(hasComplexModifiers('#大喜')).toBe(false);
    expect(hasComplexModifiers('最近90天')).toBe(false);
    expect(hasComplexModifiers('开心的事')).toBe(false);
  });

  it('detects exclusion modifiers', () => {
    expect(hasComplexModifiers('不要工作')).toBe(true);
    expect(hasComplexModifiers('排除感情相关')).toBe(true);
    expect(hasComplexModifiers('和感情无关的')).toBe(true);
    expect(hasComplexModifiers('不是技术类')).toBe(true);
  });

  it('detects replacement modifiers', () => {
    expect(hasComplexModifiers('换成工作')).toBe(true);
    expect(hasComplexModifiers('改成上个月')).toBe(true);
    expect(hasComplexModifiers('用生活标签')).toBe(true);
  });

  it('detects addition modifiers', () => {
    expect(hasComplexModifiers('再加上生活')).toBe(true);
    expect(hasComplexModifiers('加上技术')).toBe(true);
  });

  it('detects comparison modifiers', () => {
    expect(hasComplexModifiers('对比一下')).toBe(true);
    expect(hasComplexModifiers('比较工作和生活')).toBe(true);
    expect(hasComplexModifiers('有什么区别')).toBe(true);
  });

  it('detects analysis modifiers', () => {
    expect(hasComplexModifiers('最近一个月的待办')).toBe(true);
    expect(hasComplexModifiers('帮我分析一下')).toBe(true);
    expect(hasComplexModifiers('总结一下')).toBe(true);
    expect(hasComplexModifiers('我的笔记风格')).toBe(true);
    expect(hasComplexModifiers('压力大不大')).toBe(true);
    expect(hasComplexModifiers('情绪怎么样')).toBe(true);
  });

  it('returns false for simple Chinese without modifiers', () => {
    expect(hasComplexModifiers('大喜')).toBe(false);
    expect(hasComplexModifiers('工作')).toBe(false);
    expect(hasComplexModifiers('看看更多的')).toBe(false);
  });
});

// ─── createFastRetrievalPlan ────────────────────────────────────────────────

describe('createFastRetrievalPlan', () => {
  it('returns plan for explicit #tag', () => {
    const plan = createFastRetrievalPlan('#大喜', AVAILABLE_TAGS);
    expect(plan).not.toBeNull();
    expect(plan!.filters.tags.include).toContain('大喜');
    expect(plan!.retrievalNeeded).toBe(true);
    expect(plan!.pagination).toBeNull();
  });

  it('returns plan for explicit label tag', () => {
    const plan = createFastRetrievalPlan('标签 工作', AVAILABLE_TAGS);
    expect(plan).not.toBeNull();
    expect(plan!.filters.tags.include).toContain('工作');
  });

  it('returns plan for explicit time', () => {
    const plan = createFastRetrievalPlan('最近90天', AVAILABLE_TAGS);
    expect(plan).not.toBeNull();
    expect(plan!.filters.time).not.toBeNull();
    expect(plan!.filters.time!.timeKind).toBe('rolling');
    expect(plan!.filters.time!.amount).toBe(90);
  });

  it('strips explicit filters from query text', () => {
    const plan = createFastRetrievalPlan('#大喜 里面开心的事', AVAILABLE_TAGS);
    expect(plan).not.toBeNull();
    expect(plan!.query).toBe('里面开心的事');
  });

  it('returns empty query when only filters present', () => {
    const plan = createFastRetrievalPlan('#大喜 最近90天', AVAILABLE_TAGS);
    expect(plan).not.toBeNull();
    expect(plan!.query).toBe('');
  });

  it('returns null for bare tag name (no #)', () => {
    const plan = createFastRetrievalPlan('大喜', AVAILABLE_TAGS);
    expect(plan).toBeNull();
  });

  it('returns null for plain text without explicit signals', () => {
    const plan = createFastRetrievalPlan('开心的事', AVAILABLE_TAGS);
    expect(plan).toBeNull();
  });

  it('returns null when complex modifiers present even with explicit tag', () => {
    const plan = createFastRetrievalPlan('#大喜 不要感情相关', AVAILABLE_TAGS);
    expect(plan).toBeNull();
  });

  it('returns null when complex modifiers present with explicit time', () => {
    const plan = createFastRetrievalPlan('最近90天不要工作', AVAILABLE_TAGS);
    expect(plan).toBeNull();
  });

  it('handles multiple tags with match=all', () => {
    const plan = createFastRetrievalPlan('#大喜 #工作', AVAILABLE_TAGS);
    expect(plan).not.toBeNull();
    expect(plan!.filters.tags.include).toContain('大喜');
    expect(plan!.filters.tags.include).toContain('工作');
    expect(plan!.filters.tags.match).toBe('all');
  });
});

// ─── sanitizePlannerOutput ──────────────────────────────────────────────────

describe('sanitizePlannerOutput', () => {
  it('parses valid new_search output', () => {
    const raw = {
      intent: 'new_search',
      patch: { query: '开心的事', tags: { include: ['大喜'] } },
      confidence: 0.9,
      reasonCode: 'bare_tag',
    };
    const result = sanitizePlannerOutput(raw, '大喜');
    expect(result.intent).toBe('new_search');
    expect(result.patch?.query).toBe('开心的事');
    expect(result.patch?.tags?.include).toContain('大喜');
    expect(result.confidence).toBe(0.9);
  });

  it('parses chat_only output', () => {
    const raw = {
      intent: 'chat_only',
      confidence: 0.95,
      reasonCode: 'greeting',
    };
    const result = sanitizePlannerOutput(raw, '谢谢');
    expect(result.intent).toBe('chat_only');
    expect(result.confidence).toBe(0.95);
  });

  it('downgrades chat_only with low confidence to new_search', () => {
    const raw = {
      intent: 'chat_only',
      confidence: 0.5,
      reasonCode: 'followup_needs_context',
    };
    const result = sanitizePlannerOutput(raw, '你觉得呢');
    expect(result.intent).toBe('new_search');
    expect(result.reasonCode).toBe('ambiguous_retrieve');
  });

  it('defaults to new_search for unknown intent', () => {
    const raw = { intent: 'unknown_intent', confidence: 0.7 };
    const result = sanitizePlannerOutput(raw, 'test');
    expect(result.intent).toBe('new_search');
  });

  it('parses more intent', () => {
    const raw = {
      intent: 'more',
      confidence: 0.92,
      reasonCode: 'more_results',
    };
    const result = sanitizePlannerOutput(raw, '还有吗');
    expect(result.intent).toBe('more');
  });

  it('parses replace_filter intent with patch', () => {
    const raw = {
      intent: 'replace_filter',
      patch: { tags: { include: ['工作'] } },
      confidence: 0.88,
      reasonCode: 'replace_filter',
    };
    const result = sanitizePlannerOutput(raw, '换成工作');
    expect(result.intent).toBe('replace_filter');
    expect(result.patch?.tags?.include).toEqual(['工作']);
  });

  it('parses exclude_filter intent', () => {
    const raw = {
      intent: 'exclude_filter',
      patch: { tags: { exclude: ['工作'] } },
      confidence: 0.85,
      reasonCode: 'exclude_filter',
    };
    const result = sanitizePlannerOutput(raw, '不要工作');
    expect(result.intent).toBe('exclude_filter');
    expect(result.patch?.tags?.exclude).toContain('工作');
  });

  it('strips # from tags in patch', () => {
    const raw = {
      intent: 'new_search',
      patch: { tags: { include: ['#大喜'] } },
      confidence: 0.9,
      reasonCode: 'explicit_tag',
    };
    const result = sanitizePlannerOutput(raw, '#大喜');
    expect(result.patch?.tags?.include).toContain('大喜');
    expect(result.patch?.tags?.include).not.toContain('#大喜');
  });

  it('normalizes operations', () => {
    const raw = {
      intent: 'new_search',
      patch: { operations: ['summarize', 'invalid_op', 'compare'] },
      confidence: 0.9,
      reasonCode: 'note_analysis',
    };
    const result = sanitizePlannerOutput(raw, 'test');
    expect(result.patch?.operations).toEqual(['summarize', 'compare']);
  });

  it('parses Rote domain scope options', () => {
    const raw = {
      intent: 'new_search',
      patch: {
        query: '未完成的任务',
        taskStatusScope: 'open',
        archivedScope: 'active',
      },
      confidence: 0.9,
      reasonCode: 'note_analysis',
    };
    const result = sanitizePlannerOutput(raw, '未完成的任务');
    expect(result.patch?.taskStatusScope).toBe('open');
    expect(result.patch?.archivedScope).toBe('active');
  });

  it('parses semantic scope keywords separately from tags', () => {
    const raw = {
      intent: 'new_search',
      patch: {
        query: '产品相关记录',
        semanticScope: ['产品', 'AI', '产品'],
      },
      confidence: 0.9,
      reasonCode: 'note_analysis',
    };
    const result = sanitizePlannerOutput(raw, '产品相关记录');
    expect(result.patch?.semanticScope).toEqual(['产品', 'AI']);
  });
});

// ─── reducePlan ─────────────────────────────────────────────────────────────

describe('reducePlan', () => {
  it('chat_only returns non-retrieval plan', () => {
    const output: PlannerOutput = {
      intent: 'chat_only',
      confidence: 0.95,
      reasonCode: 'greeting',
    };
    const plan = reducePlan(output, null, AVAILABLE_TAGS);
    expect(plan.retrievalNeeded).toBe(false);
    expect(plan.pagination).toBeNull();
  });

  it('new_search builds plan from patch', () => {
    const output: PlannerOutput = {
      intent: 'new_search',
      patch: { query: '开心的事', tags: { include: ['大喜'] } },
      confidence: 0.9,
      reasonCode: 'bare_tag',
    };
    const plan = reducePlan(output, null, AVAILABLE_TAGS);
    expect(plan.retrievalNeeded).toBe(true);
    expect(plan.filters.tags.include).toContain('大喜');
  });

  it('more with previousPlan preserves filters and sets pagination', () => {
    const prev = makePreviousPlan({
      filters: {
        time: null,
        tags: { include: ['大喜'], exclude: [], match: 'all', unresolved: [], confidence: 1 },
        semanticScope: [],
        sourceTypes: ['rote', 'article'],
        state: 'all',
        archived: null,
      },
    });
    const output: PlannerOutput = {
      intent: 'more',
      confidence: 0.92,
      reasonCode: 'more_results',
    };
    const plan = reducePlan(output, prev, AVAILABLE_TAGS);
    expect(plan.pagination).toBe('more');
    expect(plan.retrievalNeeded).toBe(true);
    expect(plan.filters.tags.include).toContain('大喜');
  });

  it('more without previousPlan returns clarification', () => {
    const output: PlannerOutput = {
      intent: 'more',
      confidence: 0.9,
      reasonCode: 'more_results',
    };
    const plan = reducePlan(output, null, AVAILABLE_TAGS);
    expect(plan.needsClarification).toBe(true);
    expect(plan.clarificationQuestion).toContain('哪一类');
  });

  it('replace_filter overrides tags.include', () => {
    const prev = makePreviousPlan({
      filters: {
        time: null,
        tags: { include: ['生活'], exclude: [], match: 'all', unresolved: [], confidence: 1 },
        semanticScope: [],
        sourceTypes: ['rote', 'article'],
        state: 'all',
        archived: null,
      },
    });
    const output: PlannerOutput = {
      intent: 'replace_filter',
      patch: { tags: { include: ['工作'] } },
      confidence: 0.88,
      reasonCode: 'replace_filter',
    };
    const plan = reducePlan(output, prev, AVAILABLE_TAGS);
    expect(plan.filters.tags.include).toEqual(['工作']);
    expect(plan.filters.tags.include).not.toContain('生活');
  });

  it('replace_filter overrides time', () => {
    const prev = makePreviousPlan();
    const output: PlannerOutput = {
      intent: 'replace_filter',
      patch: { timeExpression: '上个月' },
      confidence: 0.88,
      reasonCode: 'replace_filter',
    };
    const plan = reducePlan(output, prev, AVAILABLE_TAGS);
    expect(plan.filters.time).not.toBeNull();
    expect(plan.filters.time!.timeKind).toBe('calendar');
    expect(plan.filters.time!.direction).toBe('previous');
  });

  it('add_filter appends to tags.include', () => {
    const prev = makePreviousPlan({
      filters: {
        time: null,
        tags: { include: ['生活'], exclude: [], match: 'all', unresolved: [], confidence: 1 },
        semanticScope: [],
        sourceTypes: ['rote', 'article'],
        state: 'all',
        archived: null,
      },
    });
    const output: PlannerOutput = {
      intent: 'add_filter',
      patch: { tags: { include: ['工作'] } },
      confidence: 0.85,
      reasonCode: 'exclude_filter',
    };
    const plan = reducePlan(output, prev, AVAILABLE_TAGS);
    expect(plan.filters.tags.include).toContain('生活');
    expect(plan.filters.tags.include).toContain('工作');
  });

  it('exclude_filter removes from include and adds to exclude', () => {
    const prev = makePreviousPlan({
      filters: {
        time: null,
        tags: {
          include: ['生活', '工作'],
          exclude: [],
          match: 'all',
          unresolved: [],
          confidence: 1,
        },
        semanticScope: [],
        sourceTypes: ['rote', 'article'],
        state: 'all',
        archived: null,
      },
    });
    const output: PlannerOutput = {
      intent: 'exclude_filter',
      patch: { tags: { exclude: ['工作'] } },
      confidence: 0.85,
      reasonCode: 'exclude_filter',
    };
    const plan = reducePlan(output, prev, AVAILABLE_TAGS);
    expect(plan.filters.tags.include).toContain('生活');
    expect(plan.filters.tags.include).not.toContain('工作');
    expect(plan.filters.tags.exclude).toContain('工作');
  });

  it('clarify returns clarification', () => {
    const output: PlannerOutput = {
      intent: 'clarify',
      confidence: 0.4,
      reasonCode: 'ambiguous_retrieve',
    };
    const plan = reducePlan(output, null, AVAILABLE_TAGS);
    expect(plan.needsClarification).toBe(true);
  });

  it('replace_filter without previousPlan falls back to new_search', () => {
    const output: PlannerOutput = {
      intent: 'replace_filter',
      patch: { tags: { include: ['工作'] } },
      confidence: 0.88,
      reasonCode: 'replace_filter',
    };
    const plan = reducePlan(output, null, AVAILABLE_TAGS);
    expect(plan.retrievalNeeded).toBe(true);
    expect(plan.filters.tags.include).toContain('工作');
  });
});

// ─── mergePlan ──────────────────────────────────────────────────────────────

describe('mergePlan', () => {
  it('replace mode overrides tags', () => {
    const prev = makePreviousPlan({
      filters: {
        time: null,
        tags: { include: ['生活'], exclude: [], match: 'all', unresolved: [], confidence: 1 },
        semanticScope: [],
        sourceTypes: ['rote', 'article'],
        state: 'all',
        archived: null,
      },
    });
    const plan = mergePlan(prev, { tags: { include: ['工作'] } }, 'replace', AVAILABLE_TAGS);
    expect(plan.filters.tags.include).toEqual(['工作']);
  });

  it('add mode appends tags', () => {
    const prev = makePreviousPlan({
      filters: {
        time: null,
        tags: { include: ['生活'], exclude: [], match: 'all', unresolved: [], confidence: 1 },
        semanticScope: [],
        sourceTypes: ['rote', 'article'],
        state: 'all',
        archived: null,
      },
    });
    const plan = mergePlan(prev, { tags: { include: ['工作'] } }, 'add', AVAILABLE_TAGS);
    expect(plan.filters.tags.include).toContain('生活');
    expect(plan.filters.tags.include).toContain('工作');
  });

  it('add mode deduplicates', () => {
    const prev = makePreviousPlan({
      filters: {
        time: null,
        tags: { include: ['生活'], exclude: [], match: 'all', unresolved: [], confidence: 1 },
        semanticScope: [],
        sourceTypes: ['rote', 'article'],
        state: 'all',
        archived: null,
      },
    });
    const plan = mergePlan(prev, { tags: { include: ['生活'] } }, 'add', AVAILABLE_TAGS);
    const lifeCount = plan.filters.tags.include.filter((t) => t === '生活').length;
    expect(lifeCount).toBe(1);
  });

  it('exclude mode removes from include and adds to exclude', () => {
    const prev = makePreviousPlan({
      filters: {
        time: null,
        tags: {
          include: ['生活', '工作'],
          exclude: [],
          match: 'all',
          unresolved: [],
          confidence: 1,
        },
        semanticScope: [],
        sourceTypes: ['rote', 'article'],
        state: 'all',
        archived: null,
      },
    });
    const plan = mergePlan(prev, { tags: { exclude: ['工作'] } }, 'exclude', AVAILABLE_TAGS);
    expect(plan.filters.tags.include).toContain('生活');
    expect(plan.filters.tags.include).not.toContain('工作');
    expect(plan.filters.tags.exclude).toContain('工作');
  });

  it('returns previousPlan when patch is undefined', () => {
    const prev = makePreviousPlan();
    const plan = mergePlan(prev, undefined, 'replace', AVAILABLE_TAGS);
    expect(plan).toBe(prev);
  });

  it('merge updates query when provided', () => {
    const prev = makePreviousPlan();
    const plan = mergePlan(prev, { query: '新的查询' }, 'replace', AVAILABLE_TAGS);
    expect(plan.query).toBe('新的查询');
    expect(plan.originalMessage).toBe('新的查询');
  });
});

// ─── buildNewSearchPlan ─────────────────────────────────────────────────────

describe('buildNewSearchPlan', () => {
  it('builds plan from patch with tags', () => {
    const plan = buildNewSearchPlan(
      { query: '开心的事', tags: { include: ['大喜'] } },
      AVAILABLE_TAGS
    );
    expect(plan.retrievalNeeded).toBe(true);
    expect(plan.filters.tags.include).toContain('大喜');
    expect(plan.query).toBe('开心的事');
  });

  it('builds plan from patch with semantic scope', () => {
    const plan = buildNewSearchPlan({ query: '相关记录', semanticScope: ['产品'] }, AVAILABLE_TAGS);
    expect(plan.filters.tags.include).toEqual([]);
    expect(plan.filters.semanticScope).toEqual(['产品']);
    expect(plan.summary).toContain('关键词：产品');
  });

  it('builds plan from patch with time', () => {
    const plan = buildNewSearchPlan({ timeExpression: '最近30天' }, AVAILABLE_TAGS);
    expect(plan.filters.time).not.toBeNull();
    expect(plan.filters.time!.timeKind).toBe('rolling');
  });

  it('defaults to summarize operation', () => {
    const plan = buildNewSearchPlan({ query: 'test' }, AVAILABLE_TAGS);
    expect(plan.operations).toEqual(['summarize']);
  });

  it('uses patch operations when provided', () => {
    const plan = buildNewSearchPlan(
      { query: 'test', operations: ['find_open_loops'] },
      AVAILABLE_TAGS
    );
    expect(plan.operations).toEqual(['find_open_loops']);
  });

  it('excludes archived notes by default for open-loop queries', () => {
    const plan = buildNewSearchPlan(
      { query: '最近没收尾的 Flag', operations: ['find_open_loops'] },
      AVAILABLE_TAGS
    );
    expect(plan.filters.archived).toBe(false);
    expect(plan.summary).toContain('未归档内容');
  });

  it('respects explicit archived scope even for task queries', () => {
    const plan = buildNewSearchPlan(
      {
        query: '归档的任务有哪些',
        operations: ['find_open_loops'],
        archivedScope: 'archived',
      },
      AVAILABLE_TAGS
    );
    expect(plan.filters.archived).toBe(true);
    expect(plan.summary).toContain('归档内容');
  });

  it('preserves explicit all scope for open-loop queries', () => {
    const plan = buildNewSearchPlan(
      {
        query: '包括归档的所有 TODO',
        operations: ['find_open_loops'],
        taskStatusScope: 'all',
      },
      AVAILABLE_TAGS
    );
    expect(plan.filters.archived).toBeNull();
    expect(plan.summary || []).not.toContain('未归档内容');
  });

  it('does not infer archived scope from task-like wording without structured scope', () => {
    const plan = buildNewSearchPlan({ query: '还有哪些任务没完成' }, AVAILABLE_TAGS);
    expect(plan.operations).toEqual(['summarize']);
    expect(plan.filters.archived).toBeNull();
  });

  it('maps taskStatusScope=open to active notes', () => {
    const plan = buildNewSearchPlan(
      { query: '还有哪些任务没完成', taskStatusScope: 'open' },
      AVAILABLE_TAGS
    );
    expect(plan.filters.archived).toBe(false);
    expect(plan.summary).toContain('未归档内容');
  });
});

// ─── fallbackPlan ───────────────────────────────────────────────────────────

describe('fallbackPlan', () => {
  it('returns minimal plan with defaults', () => {
    const plan = fallbackPlan('test message');
    expect(plan.originalMessage).toBe('test message');
    expect(plan.retrievalNeeded).toBe(true);
    expect(plan.pagination).toBeNull();
    expect(plan.needsClarification).toBe(false);
    expect(plan.confidence).toBe(0.4);
  });
});

// ─── sanitizePreviousPlan ───────────────────────────────────────────────────

describe('sanitizePreviousPlan', () => {
  it('returns null for null input', () => {
    expect(sanitizePreviousPlan(null, AVAILABLE_TAGS)).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(sanitizePreviousPlan('string', AVAILABLE_TAGS)).toBeNull();
    expect(sanitizePreviousPlan(42, AVAILABLE_TAGS)).toBeNull();
  });

  it('filters out tags not in availableTags', () => {
    const raw = {
      filters: {
        tags: { include: ['大喜', 'nonexistent_tag'], exclude: ['also_fake'] },
      },
    };
    const plan = sanitizePreviousPlan(raw, AVAILABLE_TAGS);
    expect(plan).not.toBeNull();
    expect(plan!.filters.tags.include).toContain('大喜');
    expect(plan!.filters.tags.include).not.toContain('nonexistent_tag');
    expect(plan!.filters.tags.exclude).not.toContain('also_fake');
  });

  it('preserves valid fields', () => {
    const raw = {
      originalMessage: 'test',
      query: 'test query',
      operations: ['summarize'],
      confidence: 0.8,
      retrievalNeeded: false,
      pagination: 'more',
    };
    const plan = sanitizePreviousPlan(raw, AVAILABLE_TAGS);
    expect(plan!.originalMessage).toBe('test');
    expect(plan!.query).toBe('test query');
    expect(plan!.retrievalNeeded).toBe(false);
    expect(plan!.pagination).toBe('more');
  });

  it('sanitizes sourceTypes', () => {
    const raw = {
      filters: { sourceTypes: ['rote', 'invalid', 'article'] },
    };
    const plan = sanitizePreviousPlan(raw, AVAILABLE_TAGS);
    expect(plan!.filters.sourceTypes).toEqual(['rote', 'article']);
  });

  it('defaults retrievalNeeded to true when missing', () => {
    const raw = {};
    const plan = sanitizePreviousPlan(raw, AVAILABLE_TAGS);
    expect(plan!.retrievalNeeded).toBe(true);
  });
});

// ─── sanitizeExcludeIds ─────────────────────────────────────────────────────

describe('sanitizeExcludeIds', () => {
  it('returns undefined for empty input', () => {
    expect(sanitizeExcludeIds(undefined)).toBeUndefined();
    expect(sanitizeExcludeIds([])).toBeUndefined();
  });

  it('filters valid IDs', () => {
    const result = sanitizeExcludeIds(['rote:abc123', 'article:def456']);
    expect(result).toEqual(['rote:abc123', 'article:def456']);
  });

  it('filters out invalid ID formats', () => {
    const result = sanitizeExcludeIds([
      'rote:abc123',
      'invalid:id',
      'article:def456',
      '<script>alert(1)</script>',
      '',
    ]);
    expect(result).toEqual(['rote:abc123', 'article:def456']);
  });

  it('limits to 500 entries', () => {
    const ids = Array.from({ length: 600 }, (_, i) => `rote:id${i}`);
    const result = sanitizeExcludeIds(ids);
    expect(result!.length).toBe(500);
  });

  it('returns undefined when all IDs are invalid', () => {
    const result = sanitizeExcludeIds(['invalid', 'bad']);
    expect(result).toBeUndefined();
  });
});

// ─── Continuous conversation scenarios ──────────────────────────────────────

describe('continuous conversation scenarios', () => {
  it('scenario: user asks about happy things, then says bare tag "大喜"', () => {
    // Turn 1: "所有笔记里面有哪些开心的事情" → LLM returns new_search
    const turn1Output: PlannerOutput = {
      intent: 'new_search',
      patch: { query: '开心的事情' },
      confidence: 0.85,
      reasonCode: 'note_analysis',
    };
    const turn1Plan = reducePlan(turn1Output, null, AVAILABLE_TAGS);
    expect(turn1Plan.retrievalNeeded).toBe(true);

    // Turn 2: "大喜" → LLM returns new_search with bare tag
    const turn2Output: PlannerOutput = {
      intent: 'new_search',
      patch: { tags: { include: ['大喜'] } },
      confidence: 0.88,
      reasonCode: 'bare_tag',
    };
    const turn2Plan = reducePlan(turn2Output, turn1Plan, AVAILABLE_TAGS);
    expect(turn2Plan.filters.tags.include).toContain('大喜');
    expect(turn2Plan.retrievalNeeded).toBe(true);
  });

  it('scenario: multiple "more" requests accumulate exclusions', () => {
    const prev = makePreviousPlan({
      filters: {
        time: null,
        tags: { include: ['大喜'], exclude: [], match: 'all', unresolved: [], confidence: 1 },
        semanticScope: [],
        sourceTypes: ['rote', 'article'],
        state: 'all',
        archived: null,
      },
    });

    // Turn 1: "看看更多的" → more
    const turn1Output: PlannerOutput = {
      intent: 'more',
      confidence: 0.92,
      reasonCode: 'more_results',
    };
    const plan1 = reducePlan(turn1Output, prev, AVAILABLE_TAGS);
    expect(plan1.pagination).toBe('more');

    // Turn 2: "还有吗" → more (with accumulated excludeIds from frontend)
    const turn2Output: PlannerOutput = {
      intent: 'more',
      confidence: 0.9,
      reasonCode: 'more_results',
    };
    const plan2 = reducePlan(turn2Output, plan1, AVAILABLE_TAGS);
    expect(plan2.pagination).toBe('more');
    expect(plan2.filters.tags.include).toContain('大喜');
  });

  it('scenario: replace filter then exclude filter', () => {
    const prev = makePreviousPlan({
      filters: {
        time: null,
        tags: {
          include: ['生活', '工作'],
          exclude: [],
          match: 'all',
          unresolved: [],
          confidence: 1,
        },
        semanticScope: [],
        sourceTypes: ['rote', 'article'],
        state: 'all',
        archived: null,
      },
    });

    // "换成技术" → replace
    const replaceOutput: PlannerOutput = {
      intent: 'replace_filter',
      patch: { tags: { include: ['技术'] } },
      confidence: 0.88,
      reasonCode: 'replace_filter',
    };
    const afterReplace = reducePlan(replaceOutput, prev, AVAILABLE_TAGS);
    expect(afterReplace.filters.tags.include).toEqual(['技术']);

    // "再加上生活" → add
    const addOutput: PlannerOutput = {
      intent: 'add_filter',
      patch: { tags: { include: ['生活'] } },
      confidence: 0.85,
      reasonCode: 'exclude_filter',
    };
    const afterAdd = reducePlan(addOutput, afterReplace, AVAILABLE_TAGS);
    expect(afterAdd.filters.tags.include).toContain('技术');
    expect(afterAdd.filters.tags.include).toContain('生活');

    // "不要生活" → exclude
    const excludeOutput: PlannerOutput = {
      intent: 'exclude_filter',
      patch: { tags: { exclude: ['生活'] } },
      confidence: 0.85,
      reasonCode: 'exclude_filter',
    };
    const afterExclude = reducePlan(excludeOutput, afterAdd, AVAILABLE_TAGS);
    expect(afterExclude.filters.tags.include).toContain('技术');
    expect(afterExclude.filters.tags.include).not.toContain('生活');
    expect(afterExclude.filters.tags.exclude).toContain('生活');
  });

  it('scenario: chat_only then follow-up needs context', () => {
    // "谢谢" → chat_only
    const chatOutput: PlannerOutput = {
      intent: 'chat_only',
      confidence: 0.95,
      reasonCode: 'thanks',
    };
    const chatPlan = reducePlan(chatOutput, null, AVAILABLE_TAGS);
    expect(chatPlan.retrievalNeeded).toBe(false);

    // "你觉得呢" after chat_only with no sources → chat_only
    const followupOutput: PlannerOutput = {
      intent: 'chat_only',
      confidence: 0.7, // low confidence
      reasonCode: 'followup_needs_context',
    };
    const followupPlan = reducePlan(followupOutput, chatPlan, AVAILABLE_TAGS);
    // Low confidence chat_only should be downgraded to new_search
    expect(followupPlan.retrievalNeeded).toBe(true);
  });

  it('scenario: complex query goes to LLM, not fast path', () => {
    // "最近90天不要工作相关的" → fast path returns null (complex modifier)
    const fastPlan = createFastRetrievalPlan('最近90天不要工作相关的', AVAILABLE_TAGS);
    expect(fastPlan).toBeNull();

    // LLM handles it → new_search with filters
    const llmOutput: PlannerOutput = {
      intent: 'new_search',
      patch: {
        timeExpression: '最近90天',
        tags: { exclude: ['工作'] },
      },
      confidence: 0.82,
      reasonCode: 'note_analysis',
    };
    const plan = reducePlan(llmOutput, null, AVAILABLE_TAGS);
    expect(plan.retrievalNeeded).toBe(true);
    expect(plan.filters.time).not.toBeNull();
    expect(plan.filters.tags.exclude).toContain('工作');
  });
});
