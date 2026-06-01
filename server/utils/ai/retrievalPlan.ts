import { sql } from 'drizzle-orm';
import { rotes } from '../../drizzle/schema';
import type { AiConfig } from '../../types/config';
import db from '../drizzle';
import { createChatCompletionStreamParts, type ChatCompletionUsage } from './client';

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
export type AiArchivedScope = 'active' | 'archived' | 'all' | 'unspecified';
export type AiTaskStatusScope = 'open' | 'closed' | 'all' | 'unspecified';

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
  archivedScopeSpecified?: boolean;
}

export interface AiRetrievalComparison {
  mode: 'time' | 'tag_groups' | 'filter_groups';
  groups: Array<{
    label: string;
    filters: AiRetrievalFilters;
  }>;
}

export type PlannerIntent =
  | 'chat_only'
  | 'new_search'
  | 'more'
  | 'replace_filter'
  | 'add_filter'
  | 'exclude_filter'
  | 'clarify';

export type PlannerReasonCode =
  | 'greeting'
  | 'thanks'
  | 'explicit_tag'
  | 'bare_tag'
  | 'explicit_time'
  | 'note_analysis'
  | 'more_results'
  | 'replace_filter'
  | 'exclude_filter'
  | 'ambiguous_retrieve'
  | 'followup_needs_context';

export interface PlannerOutput {
  intent: PlannerIntent;
  patch?: {
    query?: string;
    tags?: { include?: string[]; exclude?: string[] };
    semanticScope?: string[];
    timeExpression?: string;
    sourceTypes?: ('rote' | 'article')[];
    operations?: AiRetrievalOperation[];
    archivedScope?: AiArchivedScope;
    taskStatusScope?: AiTaskStatusScope;
    comparison?: {
      mode: 'time' | 'tag_groups' | 'filter_groups';
      groups: Array<{
        label: string;
        tags?: string[];
        timeExpression?: string;
        archivedScope?: AiArchivedScope;
        taskStatusScope?: AiTaskStatusScope;
      }>;
    };
  };
  confidence: number;
  reasonCode: PlannerReasonCode;
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
  retrievalNeeded: boolean;
  pagination: 'more' | null;
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

export function createDefaultFilters(): AiRetrievalFilters {
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

export function fallbackPlan(message: string): AiRetrievalPlan {
  return {
    originalMessage: message,
    operations: ['summarize'],
    query: message,
    filters: createDefaultFilters(),
    comparison: null,
    confidence: 0.4,
    needsClarification: false,
    clarificationQuestion: null,
    retrievalNeeded: true,
    pagination: null,
  };
}

const VALID_INTENTS = new Set<PlannerIntent>([
  'chat_only',
  'new_search',
  'more',
  'replace_filter',
  'add_filter',
  'exclude_filter',
  'clarify',
]);

const VALID_REASON_CODES = new Set<PlannerReasonCode>([
  'greeting',
  'thanks',
  'explicit_tag',
  'bare_tag',
  'explicit_time',
  'note_analysis',
  'more_results',
  'replace_filter',
  'exclude_filter',
  'ambiguous_retrieve',
  'followup_needs_context',
]);
const VALID_ARCHIVED_SCOPES = new Set<AiArchivedScope>([
  'active',
  'archived',
  'all',
  'unspecified',
]);
const VALID_TASK_STATUS_SCOPES = new Set<AiTaskStatusScope>([
  'open',
  'closed',
  'all',
  'unspecified',
]);
type ArchivedScopeResolution = boolean | null | undefined;

function normalizeArchivedScopeOption(value: unknown): AiArchivedScope | undefined {
  return VALID_ARCHIVED_SCOPES.has(value as AiArchivedScope)
    ? (value as AiArchivedScope)
    : undefined;
}

function normalizeTaskStatusScopeOption(value: unknown): AiTaskStatusScope | undefined {
  return VALID_TASK_STATUS_SCOPES.has(value as AiTaskStatusScope)
    ? (value as AiTaskStatusScope)
    : undefined;
}

export function sanitizePlannerOutput(raw: any, message: string): PlannerOutput {
  const intent: PlannerIntent = VALID_INTENTS.has(raw?.intent) ? raw.intent : 'new_search';
  const confidence = clampConfidence(raw?.confidence);
  const reasonCode: PlannerReasonCode = VALID_REASON_CODES.has(raw?.reasonCode)
    ? raw.reasonCode
    : 'ambiguous_retrieve';

  let patch: PlannerOutput['patch'];
  if (raw?.patch && typeof raw.patch === 'object') {
    patch = {};
    if (typeof raw.patch.query === 'string') patch.query = raw.patch.query.trim();
    if (raw.patch.tags && typeof raw.patch.tags === 'object') {
      patch.tags = {
        include: uniqueStrings(raw.patch.tags.include),
        exclude: uniqueStrings(raw.patch.tags.exclude),
      };
    }
    if (Array.isArray(raw.patch.semanticScope)) {
      patch.semanticScope = uniqueStrings(raw.patch.semanticScope).slice(0, 20);
    }
    if (typeof raw.patch.timeExpression === 'string')
      patch.timeExpression = raw.patch.timeExpression;
    if (Array.isArray(raw.patch.sourceTypes))
      patch.sourceTypes = normalizeSourceTypes(raw.patch.sourceTypes);
    patch.archivedScope = normalizeArchivedScopeOption(raw.patch.archivedScope);
    patch.taskStatusScope = normalizeTaskStatusScopeOption(raw.patch.taskStatusScope);
    if (Array.isArray(raw.patch.operations)) {
      patch.operations = raw.patch.operations.filter((op: unknown): op is AiRetrievalOperation =>
        VALID_OPERATIONS.has(op as AiRetrievalOperation)
      );
    }
    if (raw.patch.comparison && typeof raw.patch.comparison === 'object') {
      const comp = raw.patch.comparison;
      const validModes = new Set(['time', 'tag_groups', 'filter_groups']);
      patch.comparison = {
        mode: validModes.has(comp.mode) ? comp.mode : 'filter_groups',
        groups: Array.isArray(comp.groups)
          ? comp.groups.slice(0, 4).map((g: any) => ({
              label: String(g?.label || '').trim() || 'Group',
              tags: Array.isArray(g?.tags) ? uniqueStrings(g.tags) : undefined,
              timeExpression: typeof g?.timeExpression === 'string' ? g.timeExpression : undefined,
              archivedScope: normalizeArchivedScopeOption(g?.archivedScope),
              taskStatusScope: normalizeTaskStatusScopeOption(g?.taskStatusScope),
            }))
          : [],
      };
    }
  }

  // chat_only with low confidence → downgrade to new_search
  if (intent === 'chat_only' && confidence < 0.8) {
    return {
      intent: 'new_search',
      patch: patch || { query: message },
      confidence,
      reasonCode: 'ambiguous_retrieve',
    };
  }

  return { intent, patch, confidence, reasonCode };
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

function normalizeArchivedScope(
  operations: AiRetrievalOperation[],
  archived: boolean | null,
  archivedScopeSpecified?: boolean
): boolean | null {
  if (operations.includes('find_open_loops') && archived === null && !archivedScopeSpecified) {
    return false;
  }
  return archived;
}

function archivedFromDomainScopes(
  archivedScope?: AiArchivedScope,
  taskStatusScope?: AiTaskStatusScope
): ArchivedScopeResolution {
  if (archivedScope === 'active') return false;
  if (archivedScope === 'archived') return true;
  if (archivedScope === 'all') return null;

  if (taskStatusScope === 'open') return false;
  if (taskStatusScope === 'closed') return true;
  if (taskStatusScope === 'all') return null;

  return undefined;
}

function applyArchivedScopeResolution<T extends { archived: boolean | null }>(
  filters: T,
  resolution: ArchivedScopeResolution
): T & { archivedScopeSpecified?: boolean } {
  if (resolution === undefined) return filters;
  return {
    ...filters,
    archived: resolution,
    archivedScopeSpecified: true,
  };
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
  } else if (time) {
    // Time was provided but didn't match any specific pattern — apply default window
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
  // else: no time specified → leave normalized = null, no time restriction

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
      archived: normalizeArchivedScope(
        operations,
        tagResult.filters.archived,
        tagResult.filters.archivedScopeSpecified
      ),
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
  if (plan.pagination === 'more') summary.push('查看更多');
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

const COMPLEX_MODIFIER_PATTERNS = [
  /不要|排除|无关|不是/,
  /换成|改成|用/,
  /再加|加上/,
  /对比|比较|区别/,
  /待办|todo|任务/,
  /分析|总结|风格|压力|情绪/,
];

export function hasComplexModifiers(message: string): boolean {
  // Strip #hashtag references so tag names don't false-positive as modifiers
  const stripped = message.replace(/#[\p{L}\p{N}_-]+/gu, '');
  return COMPLEX_MODIFIER_PATTERNS.some((p) => p.test(stripped));
}

export function buildNewSearchPlan(
  patch: PlannerOutput['patch'],
  availableTags: string[]
): AiRetrievalPlan {
  const message = patch?.query || '';
  const operations: AiRetrievalOperation[] = patch?.operations?.length
    ? patch.operations
    : ['summarize'];
  const filters = createDefaultFilters();
  if (patch?.tags?.include) filters.tags.include = patch.tags.include;
  if (patch?.tags?.exclude) filters.tags.exclude = patch.tags.exclude;
  if (patch?.semanticScope) filters.semanticScope = patch.semanticScope;
  if (patch?.sourceTypes) filters.sourceTypes = patch.sourceTypes;
  if (patch?.timeExpression) {
    filters.time = detectFastTime(patch.timeExpression);
  }
  const archivedFromScopes = archivedFromDomainScopes(patch?.archivedScope, patch?.taskStatusScope);
  const scopedFilters = applyArchivedScopeResolution(filters, archivedFromScopes);
  filters.tags.match = filters.tags.include.length > 1 ? 'all' : 'any';

  let comparison: AiRetrievalComparison | null = null;
  if (patch?.comparison && patch.comparison.groups.length >= 2) {
    comparison = {
      mode: patch.comparison.mode,
      groups: patch.comparison.groups.map((g) => {
        const groupFilters = createDefaultFilters();
        if (g.tags) groupFilters.tags.include = g.tags;
        if (g.timeExpression) groupFilters.time = detectFastTime(g.timeExpression);
        const groupArchivedFromScopes = archivedFromDomainScopes(
          g.archivedScope,
          g.taskStatusScope
        );
        const scopedGroupFilters = applyArchivedScopeResolution(
          groupFilters,
          groupArchivedFromScopes
        );
        groupFilters.tags.match = groupFilters.tags.include.length > 1 ? 'all' : 'any';
        return { label: g.label, filters: scopedGroupFilters };
      }),
    };
  }

  return normalizePlan(
    message,
    {
      originalMessage: message,
      operations,
      query: message,
      filters: scopedFilters,
      comparison,
      confidence: 0.9,
      needsClarification: false,
      clarificationQuestion: null,
      retrievalNeeded: true,
      pagination: null,
    },
    availableTags
  );
}

export function mergePlan(
  previousPlan: AiRetrievalPlan,
  patch: PlannerOutput['patch'] | undefined,
  mode: 'replace' | 'add' | 'exclude',
  _availableTags: string[]
): AiRetrievalPlan {
  if (!patch) return previousPlan;
  const merged = { ...previousPlan, originalMessage: patch.query || previousPlan.originalMessage };

  if (patch.query) merged.query = patch.query;
  if (patch.operations) merged.operations = patch.operations;
  if (patch.semanticScope) {
    merged.filters = {
      ...merged.filters,
      semanticScope: Array.from(
        new Set([...merged.filters.semanticScope, ...(patch.semanticScope || [])])
      ).slice(0, 20),
    };
  }

  if (patch.timeExpression) {
    merged.filters = { ...merged.filters, time: detectFastTime(patch.timeExpression) };
  }

  const archivedFromScopes = archivedFromDomainScopes(patch.archivedScope, patch.taskStatusScope);
  merged.filters = applyArchivedScopeResolution(merged.filters, archivedFromScopes);

  if (patch.tags) {
    const prevInclude = new Set(merged.filters.tags.include);
    const prevExclude = new Set(merged.filters.tags.exclude);
    const patchInclude = new Set(patch.tags.include || []);
    const patchExclude = new Set(patch.tags.exclude || []);

    if (mode === 'replace') {
      merged.filters = {
        ...merged.filters,
        tags: {
          ...merged.filters.tags,
          include: Array.from(patchInclude),
          exclude: Array.from(patchExclude),
          match: patchInclude.size > 1 ? 'all' : 'any',
        },
      };
    } else if (mode === 'add') {
      patchInclude.forEach((t) => prevInclude.add(t));
      merged.filters = {
        ...merged.filters,
        tags: {
          ...merged.filters.tags,
          include: Array.from(prevInclude),
          match: prevInclude.size > 1 ? 'all' : 'any',
        },
      };
    } else if (mode === 'exclude') {
      patchExclude.forEach((t) => {
        prevExclude.add(t);
        prevInclude.delete(t);
      });
      merged.filters = {
        ...merged.filters,
        tags: {
          ...merged.filters.tags,
          include: Array.from(prevInclude),
          exclude: Array.from(prevExclude),
          match: prevInclude.size > 1 ? 'all' : 'any',
        },
      };
    }
  }

  merged.summary = buildSummary(merged);
  return merged;
}

export function reducePlan(
  output: PlannerOutput,
  previousPlan: AiRetrievalPlan | null,
  availableTags: string[]
): AiRetrievalPlan {
  // chat_only with low confidence → downgrade to new_search
  if (output.intent === 'chat_only' && output.confidence < 0.8) {
    output = { ...output, intent: 'new_search', reasonCode: 'ambiguous_retrieve' };
  }

  switch (output.intent) {
    case 'chat_only':
      return { ...fallbackPlan(''), retrievalNeeded: false, pagination: null };

    case 'new_search':
      return buildNewSearchPlan(output.patch, availableTags);

    case 'more':
      if (!previousPlan) {
        return {
          ...fallbackPlan(output.patch?.query || ''),
          needsClarification: true,
          clarificationQuestion: '你想看哪一类笔记的更多结果？',
          retrievalNeeded: false,
          pagination: null,
        };
      }
      return { ...previousPlan, pagination: 'more', retrievalNeeded: true };

    case 'replace_filter':
      if (!previousPlan) return buildNewSearchPlan(output.patch, availableTags);
      return mergePlan(previousPlan, output.patch, 'replace', availableTags);

    case 'add_filter':
      if (!previousPlan) return buildNewSearchPlan(output.patch, availableTags);
      return mergePlan(previousPlan, output.patch, 'add', availableTags);

    case 'exclude_filter':
      if (!previousPlan) return buildNewSearchPlan(output.patch, availableTags);
      return mergePlan(previousPlan, output.patch, 'exclude', availableTags);

    case 'clarify':
      return {
        ...fallbackPlan(''),
        needsClarification: true,
        clarificationQuestion: '可以再具体一点吗？',
        retrievalNeeded: false,
        pagination: null,
      };
  }
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
  "intent": "chat_only" | "new_search" | "more" | "replace_filter" | "add_filter" | "exclude_filter" | "clarify",
  "patch": {
    "query": string (optional - the semantic search query),
    "tags": {"include": string[], "exclude": string[]} (optional),
    "semanticScope": string[] (optional - soft topic keywords that are NOT hard tags),
    "timeExpression": string (optional - e.g. "最近90天", "本月"),
    "sourceTypes": ("rote" | "article")[] (optional),
    "operations": ("summarize" | "compare" | "timeline" | "find_open_loops" | "analyze_mood" | "analyze_stress" | "analyze_personality")[] (optional),
    "archivedScope": "active" | "archived" | "all" | "unspecified" (optional - Rote lifecycle filter),
    "taskStatusScope": "open" | "closed" | "all" | "unspecified" (optional - Rote task/open-loop status),
    "comparison": {"mode": "tag_groups" | "filter_groups" | "time", "groups": [{"label": string, "tags": string[] (optional), "timeExpression": string (optional), "archivedScope": string (optional), "taskStatusScope": string (optional)}]} (optional - required when operations includes "compare")
  },
  "confidence": number (0-1),
  "reasonCode": "greeting" | "thanks" | "explicit_tag" | "bare_tag" | "explicit_time" | "note_analysis" | "more_results" | "replace_filter" | "exclude_filter" | "ambiguous_retrieve" | "followup_needs_context"
}

INTENT RULES:
- "chat_only": Pure chat/greeting with NO note retrieval needed ("谢谢", "你好", "哈哈", "ok"). Confidence must be >= 0.8.
- IMPORTANT: If the previous assistant turn had retrieved sources, messages like "你觉得呢", "那怎么办", "为什么" are follow-ups that need context — use "new_search", NOT "chat_only".
- "new_search": New query — note content search, bare tag names matching available tags, analysis requests ("所有笔记里有哪些开心的", "大喜", "我最近压力大吗").
- "more": User wants additional results ("看看更多", "还有吗", "more", "多来几条", "还有别的吗", "继续看", "再给我一些"). Do NOT modify patch filters.
- "replace_filter": Replace a filter ("换成工作" → patch.tags.include=["工作"], "用上个月" → patch.timeExpression="上个月"). Only fill the field being replaced.
- "add_filter": Add a filter ("再加上生活" → patch.tags.include=["生活"]).
- "exclude_filter": Exclude a filter ("不要工作" → patch.tags.exclude=["工作"]).
- "clarify": Message too ambiguous to determine intent.

PATCH RULES:
- patch only fills fields that CHANGE. Do NOT copy the full plan.
- Bare tag names matching available tags → intent="new_search", patch.tags.include=["tagname"].
- Topic words that are not explicit tags, such as 产品/生活/AI/技术, should go into patch.semanticScope instead of patch.tags unless they exactly match an available tag or the user explicitly says #tag/标签.
- For operations: 没收尾/Flag/TODO/待办/还没做 → "find_open_loops"; 心境/情绪/心情 → "analyze_mood"; 压力/焦虑 → "analyze_stress"; MBTI/性格 → "analyze_personality"; 时间线 → "timeline"; 对比/比较 → "compare".
- Rote domain scopes: archivedScope filters the note lifecycle ("active" = not archived, "archived" = archived notes, "all" = both). taskStatusScope describes task semantics ("open" = unfinished/open task, "closed" = completed/closed task, "all" = both).
- Archived notes are considered closed/completed for task analysis. For open-loop/TODO/Flag queries, set patch.taskStatusScope="open". If the user explicitly asks for archived/completed tasks, set taskStatusScope="closed" or archivedScope="archived".
- Do NOT set archivedScope just because the word "归档/archive" is the topic of the note or feature (e.g. "归档功能 bug"). In that case keep archivedScope="unspecified" or omit it and keep the word in query.
- When operations includes "compare", you MUST also fill patch.comparison with mode="tag_groups" (for comparing tags) or mode="time" (for comparing time periods). Each group needs a label and its own tags/timeExpression.
- 笔记/记录 → patch.sourceTypes=["rote"]; 文章/长文 → ["article"].

CONFIDENCE:
- When uncertain, prefer "new_search" over "chat_only" to avoid missing retrieval.
- chat_only confidence < 0.8 will be auto-downgraded to new_search.

REASON CODE:
- Use reasonCode to annotate WHY you chose this intent, for debugging and evaluation.`;
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

export function createFastRetrievalPlan(
  message: string,
  availableTags: string[]
): AiRetrievalPlan | null {
  const tags = [...extractExplicitHashTags(message), ...extractExplicitLabelTags(message)];
  const time = detectFastTime(message);

  // Only fast-path when there are explicit signals AND no complex modifiers
  if ((tags.length > 0 || time) && !hasComplexModifiers(message)) {
    // Strip explicit filters from the query text to avoid polluting vector search
    const stripped = message
      .replace(/#[\p{L}\p{N}_-]+/gu, '')
      .replace(/标签\s*\S+/g, '')
      .replace(
        /最近\d+[天周月年]|今天|昨天|本月|上个月|全部|\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\s*(?:到|至|~|-|—)\s*\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/g,
        ''
      )
      .trim();

    const filters = createDefaultFilters();
    filters.tags.include = tags;
    filters.tags.match = tags.length > 1 ? 'all' : 'any';
    filters.time = time;

    return normalizePlan(
      message,
      {
        originalMessage: message,
        operations: ['summarize'],
        query: stripped || '',
        filters,
        comparison: null,
        confidence: 0.95,
        needsClarification: false,
        clarificationQuestion: null,
        retrievalNeeded: true,
        pagination: null,
      },
      availableTags
    );
  }

  // No explicit signals, or complex modifiers present → let LLM handle it
  return null;
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
  previousPlan?: AiRetrievalPlan | null;
  history?: { role: 'user' | 'assistant'; content: string }[];
  onThinkingDelta?: (text: string) => Promise<void> | void;
  onUsage?: (usage: ChatCompletionUsage) => Promise<void> | void;
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

  // Fast path: explicit #tag / 标签 xxx / explicit time with no complex modifiers
  const fastPlan = createFastRetrievalPlan(message, availableTags);
  if (fastPlan) {
    return fastPlan;
  }

  // LLM planner path: intent + patch + confidence + reasonCode
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
      } else if (part.type === 'content') {
        raw += part.text;
      } else if (part.type === 'usage') {
        await params.onUsage?.(part.usage);
      }
    }
    const parsed = parsePlannerJson(raw);
    const plannerOutput = sanitizePlannerOutput(parsed, message);
    return reducePlan(plannerOutput, params.previousPlan || null, availableTags);
  } catch {
    return normalizePlan(message, fallbackPlan(message), availableTags);
  }
}
