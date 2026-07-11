/**
 * Memory Integration Tests
 *
 * 直接调用 prepareRoteChatContext + createChatCompletionStream，
 * 验证完整的 LLM Planner → pgvector 检索 → Chat 补全 pipeline。
 *
 * 运行: bun test tests/aiIntegration.test.ts
 * 前置: PostgreSQL 运行中 + DB 有数据 + AI config 已配置
 */
import { describe, test, expect, beforeAll } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db } from '../utils/drizzle';
import { users } from '../drizzle/schema';
import { prepareRoteChatContext } from '../utils/dbMethods/ai';
import { createChatCompletionStream } from '../utils/ai/client';
import { canonicalizeSearchRotesArgs, getUserRoteTags } from '../utils/ai/retrievalPlan';

let testUserId = '';
let availableTags: string[] = [];

beforeAll(async () => {
  let allUsers = await db.select().from(users).where(eq(users.emailVerified, true)).limit(1);
  if (allUsers.length === 0) {
    allUsers = await db.select().from(users).limit(1);
  }
  if (allUsers.length === 0) throw new Error('No users in database');
  testUserId = allUsers[0].id;
  availableTags = await getUserRoteTags(testUserId);
  console.log(`\n[Test Setup] User: ${allUsers[0].username} (${testUserId})`);
  console.log(`[Test Setup] Available tags: ${availableTags.length} tags`);
});

interface ChatResult {
  plan: any;
  sources: any[];
  answer: string;
  planTime: number;
  totalTime: number;
}

async function runChat(
  message: string,
  options: {
    previousPlan?: any;
    excludeIds?: string[];
    history?: { role: 'user' | 'assistant'; content: string }[];
    limit?: number;
  } = {}
): Promise<ChatResult> {
  const planStart = Date.now();
  const context = await prepareRoteChatContext({
    ownerId: testUserId,
    message,
    limit: options.limit || 8,
    excludeIds: options.excludeIds,
    history: options.history,
    onPlanThinkingDelta: () => {},
    onPlanGenerated: () => {},
  });
  const planTime = Date.now() - planStart;

  if (context.clarification) {
    return {
      plan: { clarification: context.clarification },
      sources: [],
      answer: context.clarification.question,
      planTime,
      totalTime: planTime,
    };
  }
  if (!context.plan.retrievalNeeded) {
    return {
      plan: context.plan,
      sources: [],
      answer: '[chat_only]',
      planTime,
      totalTime: planTime,
    };
  }

  const genStart = Date.now();
  let answer = '';
  for await (const chunk of createChatCompletionStream(context.config.chat, context.messages)) {
    answer += chunk;
  }
  return {
    plan: context.plan,
    sources: context.sources,
    answer,
    planTime,
    totalTime: Date.now() - genStart + planTime,
  };
}

function log(label: string, r: ChatResult) {
  const tags = r.plan.scope?.tags?.join(',') || '';
  const time = r.plan.scope?.timeRange?.label || '';
  console.log(
    `  [${label}] plan=${r.plan.retrievalNeeded ? 'retrieve' : 'chat'} selection=${r.plan.scope?.selection || ''} tags=${tags} time=${time} sources=${r.sources.length} answer=${r.answer.length}ch plan=${r.planTime}ms total=${r.totalTime}ms`
  );
}

// ============================================================
// 1. Fast Path — 显式 #tag / 时间走快速路径
// ============================================================
describe('Fast Path', () => {
  test('#tag → plan has tag filter', async () => {
    const tag = availableTags.find((t) => ['todo', 'solved', 'rote', '生活'].includes(t));
    if (!tag) return console.log('  [SKIP]');
    const r = await runChat(`#${tag}`);
    log(`#${tag}`, r);
    expect(r.plan.retrievalNeeded).toBe(true);
    expect(r.plan.scope.tags).toContain(tag);
  }, 30_000);

  test('最近90天 → plan has time filter', async () => {
    const r = await runChat('最近90天');
    log('最近90天', r);
    expect(r.plan.retrievalNeeded).toBe(true);
    expect(r.plan.scope.timeRange).not.toBeNull();
  }, 30_000);

  test('#tag + query → query stripped of #tag', async () => {
    const tag = availableTags.find((t) => ['todo', 'solved', 'rote'].includes(t));
    if (!tag) return console.log('  [SKIP]');
    const r = await runChat(`#${tag} 里面开心的事`);
    log(`#${tag}+query`, r);
    expect(r.plan.retrievalNeeded).toBe(true);
    expect(r.plan.scope.query).not.toContain(`#${tag}`);
    expect(r.plan.scope.query).toContain('开心');
  }, 30_000);

  test('全部 → all_time, retrieves sources', async () => {
    const r = await runChat('全部');
    log('全部', r);
    expect(r.plan.retrievalNeeded).toBe(true);
    // "全部" triggers all_time → no time restriction → should find sources
    expect(r.sources.length).toBeGreaterThan(0);
  }, 60_000);

  test('不存在的标签 → plan exists but no sources', async () => {
    const r = await runChat('#nonexistent_xyz_123');
    log('nonexistent', r);
    expect(r.plan).toBeDefined();
    expect(r.sources.length).toBe(0);
  }, 30_000);
});

// ============================================================
// 2. LLM Planner — 自然语言 / 裸标签走 LLM
// ============================================================
describe('LLM Planner', () => {
  test('自然语言 → retrievalNeeded + answer', async () => {
    const r = await runChat('所有笔记里面有哪些开心的事情');
    log('natural language', r);
    expect(r.plan.retrievalNeeded).toBe(true);
    expect(r.answer.length).toBeGreaterThan(10);
  }, 60_000);

  test('裸标签名 → LLM recognizes tag', async () => {
    const tag = availableTags.find((t) => t === 'todo' || t === '生活');
    if (!tag) return console.log('  [SKIP]');
    const r = await runChat(tag);
    log(`bare:${tag}`, r);
    expect(r.plan.retrievalNeeded).toBe(true);
    expect(r.plan.scope.tags.length).toBeGreaterThan(0);
  }, 60_000);
});

// ============================================================
// 3. chat_only — 闲聊不检索
// ============================================================
describe('chat_only', () => {
  test('谢谢 → no retrieval', async () => {
    const r = await runChat('谢谢');
    log('谢谢', r);
    expect(r.plan.retrievalNeeded).toBe(false);
  }, 30_000);

  test('你好 → no retrieval', async () => {
    const r = await runChat('你好');
    log('你好', r);
    expect(r.plan.retrievalNeeded).toBe(false);
  }, 30_000);

  test('哈哈 → no retrieval', async () => {
    const r = await runChat('哈哈');
    log('哈哈', r);
    expect(r.plan.retrievalNeeded).toBe(false);
  }, 30_000);
});

// ============================================================
// 4. 多轮对话 — previousPlan + excludeIds
// ============================================================
describe('Multi-turn', () => {
  test('全部 → more → more (pagination accumulation)', async () => {
    // Turn 1: use "全部" to ensure we get sources
    const t1 = await runChat('全部', { limit: 3 });
    log('T1:全部', t1);
    expect(t1.plan.retrievalNeeded).toBe(true);
    expect(t1.sources.length).toBeGreaterThan(0);

    const t1Ids = t1.sources.map((s) => `${s.sourceType}:${s.sourceId}`);
    console.log(`    IDs: ${t1Ids.join(', ')}`);

    // Turn 2: "看看更多的"
    const t2 = await runChat('看看更多的', { previousPlan: t1.plan, excludeIds: t1Ids, limit: 3 });
    log('T2:more', t2);
    expect(t2.plan.retrievalNeeded).toBe(true);
    expect(t2.plan.scope.excludeIds).toEqual(expect.arrayContaining(t1Ids));

    const t2Ids = t2.sources.map((s) => `${s.sourceType}:${s.sourceId}`);
    const overlap12 = t1Ids.filter((id) => t2Ids.includes(id));
    expect(overlap12.length).toBe(0);
    console.log(`    T1∩T2: ${overlap12.length}`);

    // Turn 3: "还有别的吗"
    const allSeen = [...t1Ids, ...t2Ids];
    const t3 = await runChat('还有别的吗', {
      previousPlan: t2.plan,
      excludeIds: allSeen,
      limit: 3,
    });
    log('T3:more', t3);
    expect(t3.plan.retrievalNeeded).toBe(true);
    const t3Ids = t3.sources.map((s) => `${s.sourceType}:${s.sourceId}`);
    const overlapAll = allSeen.filter((id) => t3Ids.includes(id));
    expect(overlapAll.length).toBe(0);
    console.log(`    T1∩T2∩T3: ${overlapAll.length}`);
  }, 120_000);

  test('search → follow-up uses context', async () => {
    const t1 = await runChat('全部', { limit: 3 });
    log('T1:全部', t1);
    if (t1.sources.length === 0) return console.log('  [SKIP] no sources');

    const t2 = await runChat('你觉得呢', {
      previousPlan: t1.plan,
      history: [
        { role: 'user', content: '全部' },
        { role: 'assistant', content: t1.answer.slice(0, 200) },
      ],
    });
    log('T2:follow-up', t2);
    expect(t2.answer.length).toBeGreaterThan(5);
  }, 60_000);
});

// ============================================================
// 5. 复杂修饰词 — 走 LLM 不走 fast path
// ============================================================
describe('Complex Modifiers', () => {
  test('不要X → fast path null', () => {
    const p1 = canonicalizeSearchRotesArgs({
      ownerId: testUserId,
      availableTags,
      args: { tags: ['todo'], taskStatusScope: 'closed' },
    });
    const p2 = canonicalizeSearchRotesArgs({
      ownerId: testUserId,
      availableTags,
      args: { timeExpression: '最近90天', semanticScope: ['rote'], taskStatusScope: 'open' },
    });
    expect(p1.scope.taskStatusScope).toBe('closed');
    expect(p2.scope.timeRange?.label).toBe('最近90天');
  });

  test('对比一下 → fast path null', () => {
    const scoped = canonicalizeSearchRotesArgs({
      ownerId: testUserId,
      availableTags,
      args: { tags: ['todo', 'solved'] },
    });
    expect(scoped.scope.semanticScope.length + scoped.scope.tags.length).toBeGreaterThan(0);
  });

  test('换成X → fast path null', () => {
    const replaced = canonicalizeSearchRotesArgs({
      ownerId: testUserId,
      availableTags,
      args: { tags: ['生活'] },
    });
    expect(
      replaced.scope.tags.includes('生活') || replaced.scope.semanticScope.includes('生活')
    ).toBe(true);
  });

  test('不要X → full pipeline works', async () => {
    const r = await runChat('全部不要todo相关的');
    log('不要 modifier', r);
    expect(r.plan.retrievalNeeded).toBe(true);
  }, 60_000);

  test('对比 → full pipeline works', async () => {
    const r = await runChat('#todo 和 #solved 对比一下');
    log('对比 modifier', r);
    expect(r.plan.retrievalNeeded).toBe(true);
  }, 60_000);
});

// ============================================================
// 6. 纯函数验证
// ============================================================
describe('Pure Functions', () => {
  test('canonicalizeSearchRotesArgs: validates tags/time/source scopes', () => {
    const tag = availableTags.find((t) => /^[a-zA-Z]/.test(t));
    if (!tag) return console.log('  [SKIP] no Latin tag');

    // Simple signals → plan
    const p1 = canonicalizeSearchRotesArgs({
      ownerId: testUserId,
      availableTags,
      args: { tags: [tag], sourceTypes: ['rote'], limit: 999 },
    });
    expect(p1.scope.tags).toContain(tag);
    expect(p1.scope.sourceTypes).toEqual(['rote']);
    expect(p1.scope.limit).toBe(50);

    const p2 = canonicalizeSearchRotesArgs({
      ownerId: testUserId,
      availableTags,
      args: { tags: ['tag'], query: '里面开心的事' },
    });
    expect(p2.scope.query).toBe('里面开心的事');
    expect(p2.scope.query).toContain('开心');

    // Complex modifiers → null
    expect(
      canonicalizeSearchRotesArgs({
        ownerId: testUserId,
        availableTags,
        args: { tags: [tag], taskStatusScope: 'open' },
      }).scope.taskStatusScope
    ).toBe('open');
  });
});
