import { sql } from 'drizzle-orm';
import { rotes } from '../../drizzle/schema';
import type { AiConfig } from '../../types/config';
import db from '../drizzle';
import { createChatCompletionStreamParts } from './client';

export type AiRetrievalOperation =
  | 'summarize'
  | 'compare'
  | 'timeline'
  | 'find_open_loops'
  | 'analyze_mood'
  | 'analyze_stress'
  | 'analyze_personality';

export type AiTimeKind =
  | 'none'
  | 'rolling'
  | 'calendar'
  | 'explicit_range'
  | 'all_time'
  | 'ambiguous';

export type AiTimeUnit = 'day' | 'week' | 'month' | 'year';
export type AiTimeDirection = 'current' | 'previous';
export type AiTagMatch = 'any' | 'all';

export interface AiTimePlan {
  timeExpression: string | null;
  timeKind: AiTimeKind;
  direction: AiTimeDirection | null;
  amount: number | null;
  unit: AiTimeUnit | null;
  from: string | null;
  to: string | null;
  confidence: number;
  needsClarification: boolean;
  normalizedRange?: AiNormalizedTimeRange | null;
}

export interface AiTagPlan {
  include: string[];
  exclude: string[];
  match: AiTagMatch;
  unresolved: string[];
  confidence: number;
}

export interface AiRetrievalFilters {
  time: AiTimePlan | null;
  tags: AiTagPlan;
  semanticScope: string[];
  sourceTypes: ('rote' | 'article')[];
  state: 'private' | 'public' | 'all';
  archived: boolean | null;
}

export interface AiRetrievalComparison {
  mode: 'time' | 'tag_groups' | 'filter_groups';
  groups: Array<{
    label: string;
    filters: AiRetrievalFilters;
  }>;
}

export interface AiRetrievalPlan {
  originalMessage?: string;
  operations: AiRetrievalOperation[];
  query: string;
  filters: AiRetrievalFilters;
  comparison: AiRetrievalComparison | null;
  confidence: number;
  needsClarification: boolean;
  clarificationQuestion: string | null;
  summary?: string[];
}

export interface AiNormalizedTimeRange {
  from: string;
  to: string;
  label: string;
}

const VALID_OPERATIONS = new Set<AiRetrievalOperation>([
  'summarize',
  'compare',
  'timeline',
  'find_open_loops',
  'analyze_mood',
  'analyze_stress',
  'analyze_personality',
]);

const VALID_SOURCE_TYPES = new Set(['rote', 'article']);
const VALID_TIME_UNITS = new Set<AiTimeUnit>(['day', 'week', 'month', 'year']);
const VALID_TIME_KINDS = new Set<AiTimeKind>([
  'none',
  'rolling',
  'calendar',
  'explicit_range',
  'all_time',
  'ambiguous',
]);

const DEFAULT_FILTERS: AiRetrievalFilters = {
  time: null,
  tags: {
    include: [],
    exclude: [],
    match: 'any',
    unresolved: [],
    confidence: 1,
  },
  semanticScope: [],
  sourceTypes: ['rote', 'article'],
  state: 'all',
  archived: null,
};

function createDefaultFilters(): AiRetrievalFilters {
  return {
    ...DEFAULT_FILTERS,
    tags: emptyTagPlan(),
    semanticScope: [],
    sourceTypes: [...DEFAULT_FILTERS.sourceTypes],
  };
}

function clampConfidence(value: unknown): number {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue)) return 0.5;
  return Math.min(Math.max(numberValue, 0), 1);
}

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .map((value) => value.replace(/^#/, ''))
    )
  );
}

function normalizeSourceTypes(values: unknown): ('rote' | 'article')[] {
  const sourceTypes = Array.isArray(values)
    ? values.filter((value): value is 'rote' | 'article' => VALID_SOURCE_TYPES.has(value))
    : [];
  return sourceTypes.length ? Array.from(new Set(sourceTypes)) : ['rote', 'article'];
}

function emptyTagPlan(): AiTagPlan {
  return {
    include: [],
    exclude: [],
    match: 'any',
    unresolved: [],
    confidence: 1,
  };
}

function addUnique<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values : [...values, value];
}

function normalizeTagPlan(value: any): AiTagPlan {
  const match = value?.match === 'all' ? 'all' : 'any';
  return {
    include: uniqueStrings(value?.include),
    exclude: uniqueStrings(value?.exclude),
    match,
    unresolved: uniqueStrings(value?.unresolved),
    confidence: clampConfidence(value?.confidence),
  };
}

function normalizeTimePlan(value: any): AiTimePlan | null {
  if (!value || typeof value !== 'object') return null;
  const timeKind = VALID_TIME_KINDS.has(value.timeKind) ? value.timeKind : 'none';
  const direction =
    value.direction === 'current' || value.direction === 'previous' ? value.direction : null;
  const unit = VALID_TIME_UNITS.has(value.unit) ? value.unit : null;
  const amount = Number.isFinite(Number(value.amount))
    ? Math.max(1, Math.floor(Number(value.amount)))
    : null;

  return {
    timeExpression: value.timeExpression ? String(value.timeExpression) : null,
    timeKind,
    direction,
    amount,
    unit,
    from: value.from ? String(value.from) : null,
    to: value.to ? String(value.to) : null,
    confidence: clampConfidence(value.confidence),
    needsClarification: value.needsClarification === true,
  };
}

function normalizeFilters(value: any): AiRetrievalFilters {
  const tags = normalizeTagPlan(value?.tags);
  return {
    time: normalizeTimePlan(value?.time),
    tags,
    semanticScope: uniqueStrings(value?.semanticScope),
    sourceTypes: normalizeSourceTypes(value?.sourceTypes),
    state: value?.state === 'private' || value?.state === 'public' ? value.state : 'all',
    archived: typeof value?.archived === 'boolean' ? value.archived : null,
  };
}

function fallbackPlan(message: string): AiRetrievalPlan {
  return {
    originalMessage: message,
    operations: ['summarize'],
    query: message,
    filters: createDefaultFilters(),
    comparison: null,
    confidence: 0.4,
    needsClarification: false,
    clarificationQuestion: null,
  };
}

function sanitizePlannerOutput(raw: any, message: string): AiRetrievalPlan {
  const operations = Array.isArray(raw?.operations)
    ? raw.operations.filter((operation: unknown): operation is AiRetrievalOperation =>
        VALID_OPERATIONS.has(operation as AiRetrievalOperation)
      )
    : [];
  const filters = normalizeFilters(raw?.filters);
  const comparison =
    raw?.comparison && typeof raw.comparison === 'object'
      ? {
          mode:
            raw.comparison.mode === 'tag_groups' ||
            raw.comparison.mode === 'filter_groups' ||
            raw.comparison.mode === 'time'
              ? raw.comparison.mode
              : 'filter_groups',
          groups: Array.isArray(raw.comparison.groups)
            ? raw.comparison.groups
                .map((group: any) => ({
                  label: String(group?.label || '').trim() || 'Group',
                  filters: normalizeFilters(group?.filters),
                }))
                .slice(0, 4)
            : [],
        }
      : null;

  return {
    originalMessage: message,
    operations: operations.length ? Array.from(new Set(operations)) : ['summarize'],
    query: String(raw?.query || message).trim() || message,
    filters,
    comparison: comparison && comparison.groups.length ? comparison : null,
    confidence: clampConfidence(raw?.confidence),
    needsClarification: raw?.needsClarification === true,
    clarificationQuestion:
      typeof raw?.clarificationQuestion === 'string' && raw.clarificationQuestion.trim()
        ? raw.clarificationQuestion.trim()
        : null,
  };
}

function parsePlannerJson(text: string): any {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error('Planner did not return valid JSON');
  }
}

export async function getUserRoteTags(ownerId: string): Promise<string[]> {
  const rows = (await db
    .select({ tags: rotes.tags })
    .from(rotes)
    .where(sql`${rotes.authorid} = ${ownerId}`)) as Array<{ tags: string[] | null }>;
  return Array.from(
    new Set(rows.flatMap((row) => (Array.isArray(row.tags) ? row.tags : [])).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));
}

function getShanghaiToday(): Date {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [year, month, day] = formatter.format(new Date()).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function toDateString(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function startOfDay(date: Date): string {
  return `${toDateString(date)}T00:00:00+08:00`;
}

function endOfDay(date: Date): string {
  return `${toDateString(date)}T23:59:59+08:00`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const maxDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, maxDay));
  return next;
}

function monthRange(year: number, monthIndex: number): AiNormalizedTimeRange {
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 0));
  return {
    from: startOfDay(start),
    to: endOfDay(end),
    label: `${year}-${pad(monthIndex + 1)}`,
  };
}

function defaultDaysForOperations(operations: AiRetrievalOperation[]): number {
  if (operations.includes('timeline')) return 30;
  if (operations.includes('compare')) return 30;
  return 90;
}

function hasAllTimeExpression(message: string, time?: AiTimePlan | null): boolean {
  const expression = `${message} ${time?.timeExpression || ''}`;
  return /全部|长期|历史|所有/.test(expression) || time?.timeKind === 'all_time';
}

function hasAmbiguousTimeExpression(time?: AiTimePlan | null): boolean {
  const expression = time?.timeExpression || '';
  return (
    time?.timeKind === 'ambiguous' &&
    /(那段|开始|以后|之前|低落|这阵子|那时候|那会儿)/.test(expression)
  );
}

function isPlainRecentExpression(expression: string): boolean {
  if (!/(最近|近期|这段时间|recently)/i.test(expression)) return false;
  return !/(\d+|[一二两三四五六七八九十]+)\s*(天|日|周|星期|个月|月|年|days?|weeks?|months?|years?)/i.test(
    expression
  );
}

function normalizeTimeRange(
  message: string,
  operations: AiRetrievalOperation[],
  time?: AiTimePlan | null
): { time: AiTimePlan | null; needsClarification: boolean } {
  if (hasAllTimeExpression(message, time)) {
    return {
      time: {
        ...(time || {
          timeExpression: '全部',
          timeKind: 'all_time',
          direction: null,
          amount: null,
          unit: null,
          from: null,
          to: null,
          confidence: 1,
          needsClarification: false,
        }),
        timeKind: 'all_time',
        normalizedRange: null,
        needsClarification: false,
      },
      needsClarification: false,
    };
  }

  if (hasAmbiguousTimeExpression(time)) {
    return { time: time || null, needsClarification: true };
  }

  const today = getShanghaiToday();
  const expression = `${message} ${time?.timeExpression || ''}`;
  const useDefaultRecentRange = isPlainRecentExpression(message);
  let range: AiNormalizedTimeRange | null = null;
  let normalized = time;

  if (/今天|今日|today/i.test(expression)) {
    range = { from: startOfDay(today), to: endOfDay(today), label: '今天' };
    normalized = {
      ...(time || {}),
      timeExpression: time?.timeExpression || '今天',
      timeKind: 'calendar',
      direction: 'current',
      amount: 1,
      unit: 'day',
      confidence: Math.max(time?.confidence || 0, 0.95),
      needsClarification: false,
      from: range.from,
      to: range.to,
    } as AiTimePlan;
  } else if (/昨天|昨日|yesterday/i.test(expression)) {
    const yesterday = addDays(today, -1);
    range = { from: startOfDay(yesterday), to: endOfDay(yesterday), label: '昨天' };
    normalized = {
      ...(time || {}),
      timeExpression: time?.timeExpression || '昨天',
      timeKind: 'calendar',
      direction: 'previous',
      amount: 1,
      unit: 'day',
      confidence: Math.max(time?.confidence || 0, 0.95),
      needsClarification: false,
      from: range.from,
      to: range.to,
    } as AiTimePlan;
  } else if (/上个月|上月|last month/i.test(expression)) {
    range = monthRange(today.getUTCFullYear(), today.getUTCMonth() - 1);
    normalized = {
      ...(time || {}),
      timeExpression: time?.timeExpression || '上个月',
      timeKind: 'calendar',
      direction: 'previous',
      amount: 1,
      unit: 'month',
      confidence: Math.max(time?.confidence || 0, 0.95),
      needsClarification: false,
      from: range.from,
      to: range.to,
    } as AiTimePlan;
  } else if (/本月|这个月|this month/i.test(expression)) {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    range = { from: startOfDay(start), to: endOfDay(today), label: '本月' };
    normalized = {
      ...(time || {}),
      timeExpression: time?.timeExpression || '本月',
      timeKind: 'calendar',
      direction: 'current',
      amount: 1,
      unit: 'month',
      confidence: Math.max(time?.confidence || 0, 0.95),
      needsClarification: false,
      from: range.from,
      to: range.to,
    } as AiTimePlan;
  } else if (!useDefaultRecentRange && time?.timeKind === 'rolling' && time.amount && time.unit) {
    const days =
      time.unit === 'day'
        ? time.amount
        : time.unit === 'week'
          ? time.amount * 7
          : time.unit === 'month'
            ? null
            : time.amount * 365;
    const start = days === null ? addMonths(today, -time.amount) : addDays(today, -days);
    range = {
      from: startOfDay(start),
      to: endOfDay(today),
      label: time.timeExpression || `最近${time.amount}${time.unit}`,
    };
    normalized = {
      ...time,
      from: range.from,
      to: range.to,
      needsClarification: false,
    };
  } else if (time?.timeKind === 'explicit_range' && time.from && time.to) {
    range = {
      from: time.from.includes('T') ? time.from : `${time.from}T00:00:00+08:00`,
      to: time.to.includes('T') ? time.to : `${time.to}T23:59:59+08:00`,
      label: time.timeExpression || '指定范围',
    };
    normalized = { ...time, from: range.from, to: range.to, needsClarification: false };
  } else {
    const days = defaultDaysForOperations(operations);
    const start = addDays(today, -days);
    range = {
      from: startOfDay(start),
      to: endOfDay(today),
      label: `最近${days}天`,
    };
    normalized = {
      timeExpression: time?.timeExpression || '最近',
      timeKind: 'rolling',
      direction: 'current',
      amount: days,
      unit: 'day',
      from: range.from,
      to: range.to,
      confidence: time?.confidence || 0.75,
      needsClarification: false,
    };
  }

  return {
    time: normalized ? { ...normalized, normalizedRange: range } : null,
    needsClarification: false,
  };
}

function extractExplicitHashTags(message: string): string[] {
  const matches = message.matchAll(/#([\p{L}\p{N}_-]+)/gu);
  return Array.from(matches, (match) => match[1]).filter(Boolean);
}

function extractExplicitLabelTags(message: string): string[] {
  const matches = message.matchAll(/标签\s*[:：#"]?\s*([\p{L}\p{N}_-]+)/gu);
  return Array.from(matches, (match) => match[1]).filter(Boolean);
}

function chineseNumberToInt(value: string): number | null {
  const trimmed = value.trim();
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) return Math.max(1, Math.floor(numeric));

  const digits: Record<string, number> = {
    零: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (trimmed in digits) return digits[trimmed];
  if (trimmed === '十') return 10;
  if (trimmed.startsWith('十')) {
    const ones = digits[trimmed.slice(1)] ?? 0;
    return 10 + ones;
  }
  if (trimmed.includes('十')) {
    const [tensText, onesText] = trimmed.split('十');
    const tens = digits[tensText] ?? 1;
    const ones = onesText ? (digits[onesText] ?? 0) : 0;
    return tens * 10 + ones;
  }
  return null;
}

function tagExists(tag: string, availableTags: Set<string>): boolean {
  return availableTags.has(tag);
}

function normalizeTagScope(
  message: string,
  filters: AiRetrievalFilters,
  availableTags: string[],
  options: { autoAddExplicitTags?: boolean } = {}
): { filters: AiRetrievalFilters; needsClarification: boolean } {
  const autoAddExplicitTags = options.autoAddExplicitTags !== false;
  const availableTagSet = new Set(availableTags);
  const explicitTags = new Set([
    ...extractExplicitHashTags(message),
    ...extractExplicitLabelTags(message),
  ]);
  const semanticScope = new Set(filters.semanticScope);
  const unresolved = new Set(filters.tags.unresolved);

  const include = filters.tags.include.filter((tag) => {
    if (tagExists(tag, availableTagSet)) return true;
    if (explicitTags.has(tag)) {
      unresolved.add(tag);
      return false;
    }
    semanticScope.add(tag);
    return false;
  });
  const exclude = filters.tags.exclude.filter((tag) => {
    if (tagExists(tag, availableTagSet)) return true;
    if (explicitTags.has(tag)) unresolved.add(tag);
    return false;
  });

  if (autoAddExplicitTags) {
    explicitTags.forEach((tag) => {
      if (!tagExists(tag, availableTagSet)) {
        unresolved.add(tag);
        return;
      }
      if (!include.includes(tag) && !exclude.includes(tag)) {
        include.push(tag);
      }
    });
  }

  return {
    filters: {
      ...filters,
      semanticScope: Array.from(semanticScope),
      tags: {
        ...filters.tags,
        include: Array.from(new Set(include)),
        exclude: Array.from(new Set(exclude)),
        unresolved: Array.from(unresolved),
      },
    },
    needsClarification: unresolved.size > 0,
  };
}

function normalizeFilterScope(
  message: string,
  operations: AiRetrievalOperation[],
  filters: AiRetrievalFilters,
  availableTags: string[],
  options: { autoAddExplicitTags?: boolean } = {}
): { filters: AiRetrievalFilters; needsClarification: boolean } {
  const tagResult = normalizeTagScope(message, filters, availableTags, options);
  const timeResult = normalizeTimeRange(message, operations, tagResult.filters.time);
  return {
    filters: {
      ...tagResult.filters,
      time: timeResult.time,
    },
    needsClarification: tagResult.needsClarification || timeResult.needsClarification,
  };
}

function normalizeComparison(
  message: string,
  operations: AiRetrievalOperation[],
  comparison: AiRetrievalComparison | null,
  availableTags: string[]
): { comparison: AiRetrievalComparison | null; needsClarification: boolean } {
  if (!comparison) return { comparison: null, needsClarification: false };
  let needsClarification = false;
  const groups = comparison.groups.map((group) => {
    const result = normalizeFilterScope(message, operations, group.filters, availableTags, {
      autoAddExplicitTags: false,
    });
    needsClarification = needsClarification || result.needsClarification;
    return {
      ...group,
      filters: result.filters,
    };
  });
  return {
    comparison: {
      ...comparison,
      groups,
    },
    needsClarification,
  };
}

function collectUnresolvedTags(plan: AiRetrievalPlan): string[] {
  const unresolved = new Set(plan.filters.tags.unresolved);
  plan.comparison?.groups.forEach((group) => {
    group.filters.tags.unresolved.forEach((tag) => unresolved.add(tag));
  });
  return Array.from(unresolved);
}

function mapFiltersTagsToSemanticScope(filters: AiRetrievalFilters): AiRetrievalFilters {
  if (filters.tags.unresolved.length === 0) return filters;
  return {
    ...filters,
    semanticScope: Array.from(new Set([...filters.semanticScope, ...filters.tags.unresolved])),
    tags: {
      ...filters.tags,
      unresolved: [],
    },
  };
}

function buildClarificationQuestion(plan: AiRetrievalPlan): string {
  const unresolved = collectUnresolvedTags(plan);
  if (unresolved.length > 0) {
    return `我没有找到标签 ${unresolved.map((tag) => `#${tag}`).join('、')}。要换成已有标签，还是不限定标签、按关键词搜索？`;
  }
  if (plan.filters.time?.needsClarification) {
    return '你想看的具体时间范围是哪一段？';
  }
  return plan.clarificationQuestion || '这个范围有点模糊，可以再具体一点吗？';
}

function buildSummary(plan: AiRetrievalPlan): string[] {
  const summary: string[] = [];
  const range = plan.filters.time?.normalizedRange;
  if (range) summary.push(`时间：${range.label}`);
  if (plan.filters.tags.include.length) {
    summary.push(`标签：${plan.filters.tags.include.map((tag) => `#${tag}`).join('、')}`);
  }
  if (plan.filters.tags.exclude.length) {
    summary.push(`排除：${plan.filters.tags.exclude.map((tag) => `#${tag}`).join('、')}`);
  }
  if (plan.filters.semanticScope.length) {
    summary.push(`关键词：${plan.filters.semanticScope.join('、')}`);
  }
  if (plan.filters.sourceTypes.length === 1) {
    summary.push(plan.filters.sourceTypes[0] === 'rote' ? '仅笔记' : '仅文章');
  }
  if (plan.filters.state !== 'all') {
    summary.push(plan.filters.state === 'public' ? '公开内容' : '私密内容');
  }
  if (plan.filters.archived !== null) {
    summary.push(plan.filters.archived ? '归档内容' : '未归档内容');
  }
  if (plan.comparison) {
    summary.push(`对比：${plan.comparison.groups.map((group) => group.label).join(' / ')}`);
  }
  return summary;
}

function normalizePlan(
  message: string,
  rawPlan: AiRetrievalPlan,
  availableTags: string[]
): AiRetrievalPlan {
  const filterResult = normalizeFilterScope(
    message,
    rawPlan.operations,
    rawPlan.filters,
    availableTags
  );
  const comparisonResult = normalizeComparison(
    message,
    rawPlan.operations,
    rawPlan.comparison,
    availableTags
  );
  const normalized: AiRetrievalPlan = {
    ...rawPlan,
    originalMessage: message,
    filters: filterResult.filters,
    comparison: comparisonResult.comparison,
  };
  const comparisonMissing =
    rawPlan.needsClarification &&
    rawPlan.operations.includes('compare') &&
    /对比|相比|比较|变化|compare/i.test(message) &&
    (!comparisonResult.comparison || comparisonResult.comparison.groups.length < 2);
  const needsClarification =
    filterResult.needsClarification ||
    comparisonResult.needsClarification ||
    comparisonMissing ||
    normalized.confidence < 0.35;
  normalized.needsClarification = needsClarification;
  normalized.clarificationQuestion = needsClarification
    ? buildClarificationQuestion(normalized)
    : null;
  normalized.summary = buildSummary(normalized);
  return normalized;
}

function buildPlannerPrompt(today: string, availableTags: string[]): string {
  return `You are the Rote AI retrieval planner. Today is ${today} in timezone Asia/Shanghai (+08:00). Return strict JSON only.

Available tags for this user: ${JSON.stringify(availableTags)}.
Available sourceTypes: ["rote","article"].

Schema:
{
  "operations": ("summarize" | "compare" | "timeline" | "find_open_loops" | "analyze_mood" | "analyze_stress" | "analyze_personality")[],
  "query": string,
  "filters": {
    "time": null | {"timeExpression": string | null, "timeKind": "none" | "rolling" | "calendar" | "explicit_range" | "all_time" | "ambiguous", "direction": null | "current" | "previous", "amount": null | number, "unit": null | "day" | "week" | "month" | "year", "from": null | string, "to": null | string, "confidence": number, "needsClarification": boolean},
    "tags": {"include": string[], "exclude": string[], "match": "any" | "all", "unresolved": string[], "confidence": number},
    "semanticScope": string[],
    "sourceTypes": ("rote" | "article")[],
    "state": "private" | "public" | "all",
    "archived": null | boolean
  },
  "comparison": null | {"mode": "time" | "tag_groups" | "filter_groups", "groups": {"label": string, "filters": same shape as filters}[]},
  "confidence": number,
  "needsClarification": boolean,
  "clarificationQuestion": null | string
}

Rules:
- Do not force everything into one intent. Use operations to describe the work.
- 没收尾/Flag/TODO/待办/还没做 -> include "find_open_loops".
- 心境/情绪/心情 -> "analyze_mood"; 压力 -> "analyze_stress"; MBTI/性格 -> "analyze_personality".
- 时间线/串起来/按时间 -> "timeline". 对比/相比/变化 -> include "compare" and fill comparison.
- #tag, "标签 xxx", and exact available tag names are hard tag filters.
- Natural scopes that are not clearly tags, such as 产品相关/技术类, should go into semanticScope, not unresolved.
- Unknown explicit #tag values must go into tags.unresolved and needsClarification=true.
- Comparing #tag A and #tag B should use comparison.mode="tag_groups" with one group per tag.
- 笔记/记录 -> sourceTypes ["rote"]; 文章/长文 -> ["article"]; default ["rote","article"].
- 公开 -> state public. 私密/私人 -> private. 未归档/排除归档 -> archived false. 归档里 -> archived true.
- For time, identify timeExpression/timeKind/amount/unit. The backend will normalize final from/to.
- If a required time or explicit tag is ambiguous, set needsClarification=true and confidence<=0.64.
- The clarification question must allow "不限定标签，按关键词搜索" when the ambiguity is an unknown explicit tag.`;
}

function detectFastOperations(message: string): AiRetrievalOperation[] {
  let operations: AiRetrievalOperation[] = [];
  if (/对比|相比|比较|变化|compare/i.test(message)) operations = addUnique(operations, 'compare');
  if (/时间线|串.*时间|按时间|timeline/i.test(message)) {
    operations = addUnique(operations, 'timeline');
  }
  if (/没收尾|未收尾|Flag|TODO|todo|待办|还没做|open loop/i.test(message)) {
    operations = addUnique(operations, 'find_open_loops');
  }
  if (/心境|情绪|心情|mood/i.test(message)) operations = addUnique(operations, 'analyze_mood');
  if (/压力|焦虑|stress/i.test(message)) operations = addUnique(operations, 'analyze_stress');
  if (/MBTI|性格|人格|personality/i.test(message)) {
    operations = addUnique(operations, 'analyze_personality');
  }
  return operations.length ? operations : ['summarize'];
}

function detectFastTime(message: string): AiTimePlan | null {
  if (/全部|长期|历史|所有/.test(message)) {
    return {
      timeExpression: '全部',
      timeKind: 'all_time',
      direction: null,
      amount: null,
      unit: null,
      from: null,
      to: null,
      confidence: 0.95,
      needsClarification: false,
    };
  }
  if (/今天|今日|today/i.test(message)) {
    return {
      timeExpression: '今天',
      timeKind: 'calendar',
      direction: 'current',
      amount: 1,
      unit: 'day',
      from: null,
      to: null,
      confidence: 0.95,
      needsClarification: false,
    };
  }
  if (/昨天|昨日|yesterday/i.test(message)) {
    return {
      timeExpression: '昨天',
      timeKind: 'calendar',
      direction: 'previous',
      amount: 1,
      unit: 'day',
      from: null,
      to: null,
      confidence: 0.95,
      needsClarification: false,
    };
  }
  if (/本月|这个月|this month/i.test(message)) {
    return {
      timeExpression: '本月',
      timeKind: 'calendar',
      direction: 'current',
      amount: 1,
      unit: 'month',
      from: null,
      to: null,
      confidence: 0.95,
      needsClarification: false,
    };
  }
  if (/上个月|上月|last month/i.test(message)) {
    return {
      timeExpression: '上个月',
      timeKind: 'calendar',
      direction: 'previous',
      amount: 1,
      unit: 'month',
      from: null,
      to: null,
      confidence: 0.95,
      needsClarification: false,
    };
  }

  const rollingMatch = message.match(
    /(?:最近|近|过去|前)\s*(\d+|[一二两三四五六七八九十]+)\s*(天|日|周|星期|个月|月|年|days?|weeks?|months?|years?)/i
  );
  if (rollingMatch) {
    const amount = chineseNumberToInt(rollingMatch[1]);
    const unitText = rollingMatch[2].toLowerCase();
    const unit: AiTimeUnit =
      unitText === '天' || unitText === '日' || unitText.startsWith('day')
        ? 'day'
        : unitText === '周' || unitText === '星期' || unitText.startsWith('week')
          ? 'week'
          : unitText === '年' || unitText.startsWith('year')
            ? 'year'
            : 'month';
    if (amount) {
      return {
        timeExpression: rollingMatch[0],
        timeKind: 'rolling',
        direction: 'current',
        amount,
        unit,
        from: null,
        to: null,
        confidence: 0.95,
        needsClarification: false,
      };
    }
  }

  const explicitRange = message.match(
    /(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})\s*(?:到|至|~|-|—)\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/
  );
  if (explicitRange) {
    return {
      timeExpression: explicitRange[0],
      timeKind: 'explicit_range',
      direction: null,
      amount: null,
      unit: null,
      from: explicitRange[1].replace(/[/.]/g, '-'),
      to: explicitRange[2].replace(/[/.]/g, '-'),
      confidence: 0.95,
      needsClarification: false,
    };
  }

  return null;
}

function detectFastSourceTypes(message: string): ('rote' | 'article')[] {
  const hasRote = /笔记|记录|note|rote/i.test(message);
  const hasArticle = /文章|长文|article/i.test(message);
  if (hasRote && !hasArticle) return ['rote'];
  if (hasArticle && !hasRote) return ['article'];
  return ['rote', 'article'];
}

function detectFastState(message: string): 'private' | 'public' | 'all' {
  if (/公开|public/i.test(message)) return 'public';
  if (/私密|私人|private/i.test(message)) return 'private';
  return 'all';
}

function detectFastArchived(message: string): boolean | null {
  if (/未归档|没归档|排除归档|非归档/i.test(message)) return false;
  if (/归档里|归档内容|已归档/i.test(message)) return true;
  return null;
}

function findAvailableTagByAlias(scope: string, availableTags: string[]): string | null {
  const lowerTags = new Map(availableTags.map((tag) => [tag.toLowerCase(), tag]));
  const aliasMap: Array<{ pattern: RegExp; candidates: string[] }> = [
    { pattern: /生活|life/i, candidates: ['life', 'lifestyle', '生活'] },
    { pattern: /工作|work/i, candidates: ['work', '工作'] },
    { pattern: /产品|product/i, candidates: ['product', '产品'] },
    { pattern: /技术|tech/i, candidates: ['tech', 'technology', '技术'] },
    { pattern: /\bAI\b|人工智能|大模型/i, candidates: ['ai', 'AI', 'Ai', '人工智能'] },
  ];
  const matched = aliasMap.find((item) => item.pattern.test(scope));
  if (!matched) return null;
  for (const candidate of matched.candidates) {
    const tag = lowerTags.get(candidate.toLowerCase());
    if (tag) return tag;
  }
  return null;
}

function cleanSemanticScope(value: string): string {
  return value
    .replace(/^只看/, '')
    .replace(/^(最近|近|过去|本月|这个月|上个月|今天|昨天)/, '')
    .replace(/(相关|类|类型|方面|的)?(记录|笔记|文章|长文|内容).*$/u, '')
    .replace(/[#，,。.？?！!]/g, ' ')
    .trim();
}

function detectSemanticScopes(
  message: string,
  availableTags: string[]
): {
  semanticScope: string[];
  mappedTags: string[];
} {
  const semanticScope = new Set<string>();
  const mappedTags = new Set<string>();
  const scopeMatches = [
    ...message.matchAll(
      /只看\s*([^，。？！?,!#]+?)(?:相关|类|类型|方面)?(?:记录|笔记|文章|长文|内容)/gu
    ),
    ...message.matchAll(
      /([A-Za-z\u4e00-\u9fa5]+)(?:相关|类|类型|方面)(?:记录|笔记|文章|长文|内容)?/gu
    ),
  ];

  scopeMatches.forEach((match) => {
    const scope = cleanSemanticScope(match[1]);
    if (!scope || /公开|私密|归档|最近|本月|上月|今天|昨天/.test(scope)) return;
    const mappedTag = findAvailableTagByAlias(scope, availableTags);
    if (mappedTag) {
      mappedTags.add(mappedTag);
    } else {
      semanticScope.add(scope);
    }
  });

  return {
    semanticScope: Array.from(semanticScope),
    mappedTags: Array.from(mappedTags),
  };
}

function isLikelyContextDependentFollowUp(message: string): boolean {
  if (extractExplicitHashTags(message).length > 0 || extractExplicitLabelTags(message).length > 0) {
    return false;
  }
  if (detectFastTime(message)) return false;
  return /^(那|那么|这个|这些|它|他们|她们|上面|刚才|继续|再|换成|改成|呢)/.test(message.trim());
}

function createFastRetrievalPlan(
  message: string,
  availableTags: string[],
  history?: { role: 'user' | 'assistant'; content: string }[]
): AiRetrievalPlan | null {
  if (history?.length && isLikelyContextDependentFollowUp(message)) return null;

  const operations = detectFastOperations(message);
  const filters = createDefaultFilters();
  filters.time = detectFastTime(message);
  filters.sourceTypes = detectFastSourceTypes(message);
  filters.state = detectFastState(message);
  filters.archived = detectFastArchived(message);
  filters.tags.include = [
    ...extractExplicitHashTags(message),
    ...extractExplicitLabelTags(message),
  ];

  const scope = detectSemanticScopes(message, availableTags);
  filters.semanticScope = scope.semanticScope;
  filters.tags.include = Array.from(new Set([...filters.tags.include, ...scope.mappedTags]));
  filters.tags.match =
    filters.tags.include.length > 1 && !operations.includes('compare') ? 'all' : 'any';

  const explicitTags = [...extractExplicitHashTags(message), ...extractExplicitLabelTags(message)];
  const comparison =
    operations.includes('compare') && explicitTags.length >= 2
      ? {
          mode: 'tag_groups' as const,
          groups: explicitTags.slice(0, 4).map((tag) => {
            const groupFilters = {
              ...filters,
              tags: { ...emptyTagPlan(), include: [tag], match: 'all' as const },
              semanticScope: [],
            };
            return {
              label: `#${tag}`,
              filters: groupFilters,
            };
          }),
        }
      : null;

  const hasFastSignal =
    filters.time ||
    filters.tags.include.length > 0 ||
    filters.semanticScope.length > 0 ||
    filters.sourceTypes.length === 1 ||
    filters.state !== 'all' ||
    filters.archived !== null ||
    operations.some((operation) => operation !== 'summarize');

  if (!hasFastSignal) return null;

  return normalizePlan(
    message,
    {
      originalMessage: message,
      operations,
      query: message,
      filters,
      comparison,
      confidence: 0.82,
      needsClarification: false,
      clarificationQuestion: null,
    },
    availableTags
  );
}

function applyClarificationAnswer(plan: AiRetrievalPlan, answer: string): AiRetrievalPlan | null {
  if (!plan.needsClarification) return plan;
  if (/不限定标签|不用标签|不要标签|按关键词|关键词搜索/i.test(answer)) {
    const filters = mapFiltersTagsToSemanticScope(plan.filters);
    const comparison = plan.comparison
      ? {
          ...plan.comparison,
          groups: plan.comparison.groups.map((group) => ({
            ...group,
            filters: mapFiltersTagsToSemanticScope(group.filters),
          })),
        }
      : null;
    const nextPlan = {
      ...plan,
      filters,
      comparison,
      needsClarification: false,
      clarificationQuestion: null,
    };
    return {
      ...nextPlan,
      summary: buildSummary(nextPlan),
    };
  }
  return null;
}

export async function createRetrievalPlan(params: {
  ownerId: string;
  message: string;
  config: AiConfig;
  pendingPlan?: AiRetrievalPlan | null;
  clarificationAnswer?: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
  onThinkingDelta?: (text: string) => Promise<void> | void;
}): Promise<AiRetrievalPlan> {
  const availableTags = await getUserRoteTags(params.ownerId);
  const clarificationPlan =
    params.pendingPlan && params.clarificationAnswer
      ? applyClarificationAnswer(params.pendingPlan, params.clarificationAnswer)
      : null;
  if (clarificationPlan) {
    return clarificationPlan;
  }

  const message = params.pendingPlan?.originalMessage
    ? `${params.pendingPlan.originalMessage}\n补充说明：${params.message}`
    : params.message;
  const fastPlan = createFastRetrievalPlan(message, availableTags, params.history);
  if (fastPlan) {
    return fastPlan;
  }

  const today = toDateString(getShanghaiToday());
  const systemPrompt = buildPlannerPrompt(today, availableTags);

  try {
    const plannerMessages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { role: 'system', content: systemPrompt },
    ];

    if (params.history && params.history.length > 0) {
      plannerMessages.push(
        ...params.history.map((m) => ({
          role: (m.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
          content: m.content,
        }))
      );
    }

    plannerMessages.push({ role: 'user', content: message });

    let raw = '';
    for await (const part of createChatCompletionStreamParts(params.config.chat, plannerMessages, {
      temperature: 0,
      enableThinking: true,
    })) {
      if (part.type === 'reasoning') {
        await params.onThinkingDelta?.(part.text);
      } else {
        raw += part.text;
      }
    }
    const parsed = parsePlannerJson(raw);
    return normalizePlan(message, sanitizePlannerOutput(parsed, message), availableTags);
  } catch {
    return normalizePlan(message, fallbackPlan(message), availableTags);
  }
}
