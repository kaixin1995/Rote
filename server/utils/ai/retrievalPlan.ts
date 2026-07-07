import { sql } from 'drizzle-orm';
import { rotes } from '../../drizzle/schema';
import type { AiConfig } from '../../types/config';
import db from '../drizzle';
import {
  createChatCompletionWithToolsStreaming,
  type ChatCompletionUsage,
  type ChatMessage,
  type ChatToolCall,
  type ChatToolDefinition,
} from './client';

export type AiSourceType = 'rote' | 'article';
export type LifecycleScope = 'active' | 'archived' | 'all' | 'unspecified';
export type TaskStatusScope = 'open' | 'closed' | 'all' | 'unspecified';
export type AiTimeUnit = 'day' | 'week' | 'month' | 'year';

export interface NormalizedTimeRange {
  from: string;
  to: string;
  label: string;
}

export type StructuredTimeRangeType = 'absolute' | 'rolling' | 'relative_between' | 'preset';
export type StructuredTimeRangePreset = 'today' | 'yesterday' | 'this_month' | 'last_month';

export interface StructuredRelativeTimePoint {
  amount?: number;
  unit?: AiTimeUnit;
  direction?: 'ago';
}

export interface StructuredTimeRange {
  type?: StructuredTimeRangeType;
  preset?: StructuredTimeRangePreset;
  fromDate?: string;
  toDate?: string;
  amount?: number;
  unit?: AiTimeUnit;
  fromRelative?: StructuredRelativeTimePoint;
  toRelative?: StructuredRelativeTimePoint;
  label?: string;
}

export interface RetrievalScope {
  ownerId: string;
  query: string;
  tags: string[];
  excludeTags: string[];
  semanticScope: string[];
  sourceTypes: AiSourceType[];
  timeRange: NormalizedTimeRange | null;
  lifecycleScope: LifecycleScope;
  taskStatusScope: TaskStatusScope;
  limit: number;
  cursor: string | null;
  excludeIds: string[];
}

export interface SearchRotesArgs {
  query?: string;
  tags?: string[];
  excludeTags?: string[];
  semanticScope?: string[];
  sourceTypes?: AiSourceType[];
  timeRange?: StructuredTimeRange;
  timeExpression?: string;
  from?: string;
  to?: string;
  lifecycleScope?: LifecycleScope;
  taskStatusScope?: TaskStatusScope;
  limit?: number;
  cursor?: string;
}

export interface RetrievalSnippet {
  id: string;
  sourceType: AiSourceType;
  sourceId: string;
  title?: string;
  tags?: string[];
  createdAt?: string;
  similarity: number;
  text: string;
}

export interface RetrievalToolResult {
  canonicalizedArgs: RetrievalScope;
  resultCount: number;
  topSnippets: RetrievalSnippet[];
  cursor: string | null;
  warnings: string[];
}

export interface SearchRotesProbeResult {
  toolResult: RetrievalToolResult;
  sources: unknown[];
}

export interface PlannerDebugTrace {
  toolCalls: Array<{
    step: number;
    name: string;
    args: unknown;
  }>;
  canonicalizedArgs: RetrievalScope[];
  warnings: string[];
  probeCounts: number[];
  finishReason?: string;
  fallbackReason?: string;
  providerError?: string;
  toolError?: string;
}

export interface PlannerAgentResult {
  originalMessage: string;
  retrievalNeeded: boolean;
  scope: RetrievalScope | null;
  toolResult: RetrievalToolResult | null;
  sources: unknown[];
  clarification: { question: string; reason?: string } | null;
  debugTrace: PlannerDebugTrace;
}

export interface PlannerAgentDto {
  originalMessage: string;
  retrievalNeeded: boolean;
  scope: RetrievalScope | null;
  toolResult: RetrievalToolResult | null;
  clarification: { question: string; reason?: string } | null;
  debugTrace: PlannerDebugTrace;
}

export type SearchRotesProbeExecutor = (scope: RetrievalScope) => Promise<SearchRotesProbeResult>;

const VALID_SOURCE_TYPES = new Set<AiSourceType>(['rote', 'article']);
const VALID_LIFECYCLE_SCOPES = new Set<LifecycleScope>([
  'active',
  'archived',
  'all',
  'unspecified',
]);
const VALID_TASK_STATUS_SCOPES = new Set<TaskStatusScope>(['open', 'closed', 'all', 'unspecified']);
const VALID_STRUCTURED_TIME_TYPES = new Set<StructuredTimeRangeType>([
  'absolute',
  'rolling',
  'relative_between',
  'preset',
]);
const VALID_STRUCTURED_TIME_PRESETS = new Set<StructuredTimeRangePreset>([
  'today',
  'yesterday',
  'this_month',
  'last_month',
]);
const VALID_STRUCTURED_TIME_UNITS = new Set<AiTimeUnit>(['day', 'week', 'month', 'year']);
const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 50;
const MAX_STEPS = 6;
const MAX_TOOL_CALLS = 10;
const DATE_ONLY_RE = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/;
const ISO_DATE_TIME_WITH_ZONE_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const RELATIVE_POINT_RE =
  /^(\d+|[一二两三四五六七八九十]+)\s*(天|日|周|星期|个月|月|年|days?|weeks?|months?|years?)\s*ago$/i;
const RELATIVE_POINT_ZH_RE = /^(\d+|[一二两三四五六七八九十]+)\s*(天|日|周|星期|个月|月|年)前$/;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function uniqueStrings(value: unknown, limit = 30): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => (typeof item === 'string' ? item.trim().replace(/^#/, '') : ''))
        .filter(Boolean)
    )
  ).slice(0, limit);
}

function clampLimit(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.floor(numeric), 1), MAX_LIMIT);
}

function normalizeSourceTypes(value: unknown, warnings: string[]): AiSourceType[] {
  if (!Array.isArray(value)) return ['rote', 'article'];
  const valid = uniqueStrings(value)
    .filter((type): type is AiSourceType => VALID_SOURCE_TYPES.has(type as AiSourceType))
    .slice(0, 2);
  const invalid = uniqueStrings(value).filter(
    (type) => !VALID_SOURCE_TYPES.has(type as AiSourceType)
  );
  invalid.forEach((type) => warnings.push(`invalid_source_type:${type}`));
  return valid.length ? valid : ['rote', 'article'];
}

function normalizeLifecycleScope(value: unknown): LifecycleScope {
  return VALID_LIFECYCLE_SCOPES.has(value as LifecycleScope)
    ? (value as LifecycleScope)
    : 'unspecified';
}

function normalizeTaskStatusScope(value: unknown): TaskStatusScope {
  return VALID_TASK_STATUS_SCOPES.has(value as TaskStatusScope)
    ? (value as TaskStatusScope)
    : 'unspecified';
}

export function lifecycleScopeToArchived(scope: LifecycleScope): boolean | null {
  if (scope === 'active') return false;
  if (scope === 'archived') return true;
  return null;
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

export async function getUserRoteTagCounts(
  ownerId: string
): Promise<Array<{ name: string; count: number }>> {
  const rows = (await db
    .select({ tags: rotes.tags })
    .from(rotes)
    .where(sql`${rotes.authorid} = ${ownerId}`)) as Array<{ tags: string[] | null }>;
  const counts = new Map<string, number>();
  rows.forEach((row) => {
    (Array.isArray(row.tags) ? row.tags : []).forEach((tag) => {
      if (tag) counts.set(tag, (counts.get(tag) || 0) + 1);
    });
  });
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
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

function monthRange(year: number, monthIndex: number, label: string): NormalizedTimeRange {
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 0));
  return { from: startOfDay(start), to: endOfDay(end), label };
}

function isValidDateParts(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) return false;
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Number.isInteger(day) && day >= 1 && day <= maxDay;
}

function isValidTimeParts(hour: number, minute: number, second: number): boolean {
  return (
    Number.isInteger(hour) &&
    hour >= 0 &&
    hour <= 23 &&
    Number.isInteger(minute) &&
    minute >= 0 &&
    minute <= 59 &&
    Number.isInteger(second) &&
    second >= 0 &&
    second <= 59
  );
}

function isValidTimezoneOffset(value: string): boolean {
  if (value === 'Z') return true;
  const match = value.match(/^([+-])(\d{2}):(\d{2})$/);
  if (!match) return false;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

function chineseNumberToInt(value: string): number | null {
  const numeric = Number(value);
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
  if (value in digits) return digits[value];
  if (value === '十') return 10;
  if (value.startsWith('十')) return 10 + (digits[value.slice(1)] ?? 0);
  if (value.includes('十')) {
    const [tensText, onesText] = value.split('十');
    return (digits[tensText] ?? 1) * 10 + (onesText ? (digits[onesText] ?? 0) : 0);
  }
  return null;
}

function unitTextToUnit(value: string): AiTimeUnit {
  const unitText = value.toLowerCase();
  return unitText === '天' || unitText === '日' || unitText.startsWith('day')
    ? 'day'
    : unitText === '周' || unitText === '星期' || unitText.startsWith('week')
      ? 'week'
      : unitText === '年' || unitText.startsWith('year')
        ? 'year'
        : 'month';
}

function addRelativeOffset(date: Date, amount: number, unit: AiTimeUnit): Date {
  if (unit === 'month') return addMonths(date, -amount);
  if (unit === 'year') return addMonths(date, -amount * 12);
  return addDays(date, -(unit === 'day' ? amount : amount * 7));
}

function parseRelativePointDate(value: string): Date | null {
  const match = value.trim().match(RELATIVE_POINT_RE) || value.trim().match(RELATIVE_POINT_ZH_RE);
  if (!match) return null;

  const amount = chineseNumberToInt(match[1]);
  if (!amount || amount > 10000) return null;
  return addRelativeOffset(getShanghaiToday(), amount, unitTextToUnit(match[2]));
}

function normalizeDateOnlyInput(value: string, end = false): string | null {
  const match = value.trim().match(DATE_ONLY_RE);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidDateParts(year, month, day)) return null;

  return `${year}-${pad(month)}-${pad(day)}${end ? 'T23:59:59+08:00' : 'T00:00:00+08:00'}`;
}

function normalizeIsoDateTimeInput(value: string): string | null {
  const normalized = value.trim();
  const match = normalized.match(ISO_DATE_TIME_WITH_ZONE_RE);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] ? Number(match[6]) : 0;
  const zone = match[8];

  if (!isValidDateParts(year, month, day)) return null;
  if (!isValidTimeParts(hour, minute, second)) return null;
  if (!isValidTimezoneOffset(zone)) return null;
  if (!Number.isFinite(Date.parse(normalized))) return null;

  return normalized;
}

function normalizeDateInput(value: string, end = false): string | null {
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.includes('T')) return normalizeIsoDateTimeInput(normalized);

  const dateOnly = normalizeDateOnlyInput(normalized, end);
  if (dateOnly) return dateOnly;

  const relativePoint = parseRelativePointDate(normalized);
  if (relativePoint) return end ? endOfDay(relativePoint) : startOfDay(relativePoint);

  return null;
}

function isOrderedTimeRange(from: string, to: string): boolean {
  const fromTime = Date.parse(from);
  const toTime = Date.parse(to);
  return Number.isFinite(fromTime) && Number.isFinite(toTime) && fromTime <= toTime;
}

export function normalizeTimeRangeInput(value: unknown): NormalizedTimeRange | null {
  const raw = asRecord(value);
  const from = typeof raw.from === 'string' ? raw.from.trim() : '';
  const to = typeof raw.to === 'string' ? raw.to.trim() : '';
  if (!from || !to) return null;

  const normalizedFrom = normalizeDateInput(from);
  const normalizedTo = normalizeDateInput(to, true);
  if (!normalizedFrom || !normalizedTo || !isOrderedTimeRange(normalizedFrom, normalizedTo)) {
    return null;
  }

  return {
    from: normalizedFrom,
    to: normalizedTo,
    label:
      typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : `${from} 到 ${to}`,
  };
}

function normalizeStructuredTimeUnit(value: unknown): AiTimeUnit | null {
  if (typeof value !== 'string') return null;
  const unit = value.trim().toLowerCase();
  if (unit === 'days') return 'day';
  if (unit === 'weeks') return 'week';
  if (unit === 'months') return 'month';
  if (unit === 'years') return 'year';
  return VALID_STRUCTURED_TIME_UNITS.has(unit as AiTimeUnit) ? (unit as AiTimeUnit) : null;
}

function normalizeStructuredAmount(value: unknown): number | null {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  const normalized = Math.floor(amount);
  return normalized >= 1 && normalized <= 10000 ? normalized : null;
}

function structuredLabel(raw: Record<string, unknown>, fallback: string): string {
  return typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : fallback;
}

function formatRelativePointLabel(point: Record<string, unknown>): string {
  const amount = normalizeStructuredAmount(point.amount) || 0;
  const unit = normalizeStructuredTimeUnit(point.unit) || 'day';
  return `${amount} ${unit}${amount === 1 ? '' : 's'} ago`;
}

function normalizeStructuredRelativePoint(value: unknown, end = false): string | null {
  const point = asRecord(value);
  const amount = normalizeStructuredAmount(point.amount);
  const unit = normalizeStructuredTimeUnit(point.unit);
  const direction = typeof point.direction === 'string' ? point.direction.trim() : 'ago';
  if (!amount || !unit || direction !== 'ago') return null;

  const date = addRelativeOffset(getShanghaiToday(), amount, unit);
  return end ? endOfDay(date) : startOfDay(date);
}

function canonicalizePresetTimeRange(
  preset: StructuredTimeRangePreset,
  raw: Record<string, unknown>
): NormalizedTimeRange {
  const today = getShanghaiToday();
  if (preset === 'today') {
    return { from: startOfDay(today), to: endOfDay(today), label: structuredLabel(raw, '今天') };
  }
  if (preset === 'yesterday') {
    const yesterday = addDays(today, -1);
    return {
      from: startOfDay(yesterday),
      to: endOfDay(yesterday),
      label: structuredLabel(raw, '昨天'),
    };
  }
  if (preset === 'this_month') {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    return {
      from: startOfDay(start),
      to: endOfDay(today),
      label: structuredLabel(raw, '本月'),
    };
  }
  const range = monthRange(today.getUTCFullYear(), today.getUTCMonth() - 1, '上个月');
  return { ...range, label: structuredLabel(raw, range.label) };
}

function canonicalizeStructuredTimeRange(value: unknown): NormalizedTimeRange | null {
  const raw = asRecord(value);
  if (!Object.keys(raw).length) return null;

  const type = VALID_STRUCTURED_TIME_TYPES.has(raw.type as StructuredTimeRangeType)
    ? (raw.type as StructuredTimeRangeType)
    : undefined;
  const preset = VALID_STRUCTURED_TIME_PRESETS.has(raw.preset as StructuredTimeRangePreset)
    ? (raw.preset as StructuredTimeRangePreset)
    : undefined;

  const parsePreset = () => {
    if (!preset) return null;
    return canonicalizePresetTimeRange(preset, raw);
  };

  const parseRolling = () => {
    const amount = normalizeStructuredAmount(raw.amount);
    const unit = normalizeStructuredTimeUnit(raw.unit);
    if (!amount || !unit) return null;
    const today = getShanghaiToday();
    const start = addRelativeOffset(today, amount, unit);
    return {
      from: startOfDay(start),
      to: endOfDay(today),
      label: structuredLabel(raw, `last ${amount} ${unit}${amount === 1 ? '' : 's'}`),
    };
  };

  const parseRelativeBetween = () => {
    const from = normalizeStructuredRelativePoint(raw.fromRelative);
    const to = normalizeStructuredRelativePoint(raw.toRelative, true);
    if (!from || !to || !isOrderedTimeRange(from, to)) return null;
    return {
      from,
      to,
      label: structuredLabel(
        raw,
        `${formatRelativePointLabel(asRecord(raw.fromRelative))} 到 ${formatRelativePointLabel(
          asRecord(raw.toRelative)
        )}`
      ),
    };
  };

  const parseAbsolute = () =>
    normalizeTimeRangeInput({
      from: raw.fromDate,
      to: raw.toDate,
      label: raw.label,
    });

  if (type) {
    if (type === 'absolute') return parseAbsolute();
    if (type === 'rolling') return parseRolling();
    if (type === 'relative_between') return parseRelativeBetween();
    return parsePreset();
  }

  if (preset) return parsePreset();
  if (raw.fromRelative || raw.toRelative) return parseRelativeBetween();
  if (raw.amount !== undefined || raw.unit !== undefined) return parseRolling();
  if (raw.fromDate !== undefined || raw.toDate !== undefined) return parseAbsolute();

  return null;
}

export function canonicalizeTimeRange(
  args: SearchRotesArgs,
  warnings?: string[]
): NormalizedTimeRange | null {
  if (args.timeRange !== undefined) {
    const structured = canonicalizeStructuredTimeRange(args.timeRange);
    if (structured) return structured;
    warnings?.push('invalid_time_range_ignored');
  }

  const from = typeof args.from === 'string' ? args.from.trim() : '';
  const to = typeof args.to === 'string' ? args.to.trim() : '';
  if (from && to) {
    const normalized = normalizeTimeRangeInput({ from, to, label: `${from} 到 ${to}` });
    if (!normalized) warnings?.push('invalid_time_range_ignored');
    return normalized;
  }

  const expression = typeof args.timeExpression === 'string' ? args.timeExpression.trim() : '';
  if (!expression) return null;

  const today = getShanghaiToday();
  if (/今天|今日|today/i.test(expression)) {
    return { from: startOfDay(today), to: endOfDay(today), label: '今天' };
  }
  if (/昨天|昨日|yesterday/i.test(expression)) {
    const yesterday = addDays(today, -1);
    return { from: startOfDay(yesterday), to: endOfDay(yesterday), label: '昨天' };
  }
  if (/本月|这个月|this month/i.test(expression)) {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    return { from: startOfDay(start), to: endOfDay(today), label: '本月' };
  }
  if (/上个月|上月|last month/i.test(expression)) {
    return monthRange(today.getUTCFullYear(), today.getUTCMonth() - 1, '上个月');
  }

  const rollingMatch = expression.match(
    /(?:最近|近|过去|前|last|past|previous|recent)\s*(\d+|[一二两三四五六七八九十]+)\s*(天|日|周|星期|个月|月|年|days?|weeks?|months?|years?)/i
  );
  if (rollingMatch) {
    const amount = chineseNumberToInt(rollingMatch[1]);
    if (amount) {
      const start = addRelativeOffset(today, amount, unitTextToUnit(rollingMatch[2]));
      return { from: startOfDay(start), to: endOfDay(today), label: rollingMatch[0] };
    }
  }

  const explicitRange = expression.match(
    /(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})\s*(?:到|至|~|-|—)\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/
  );
  if (explicitRange) {
    const normalized = normalizeTimeRangeInput({
      from: explicitRange[1],
      to: explicitRange[2],
      label: explicitRange[0],
    });
    if (!normalized) warnings?.push('invalid_time_range_ignored');
    return normalized;
  }

  return null;
}

export function canonicalizeSearchRotesArgs(params: {
  ownerId: string;
  args: SearchRotesArgs;
  availableTags: string[];
  excludeIds?: string[];
}): { scope: RetrievalScope; warnings: string[] } {
  const warnings: string[] = [];
  const availableTagSet = new Set(params.availableTags);
  const semanticScope = new Set(uniqueStrings(params.args.semanticScope));
  const tags: string[] = [];
  const excludeTags: string[] = [];

  uniqueStrings(params.args.tags).forEach((tag) => {
    if (availableTagSet.has(tag)) {
      tags.push(tag);
    } else {
      semanticScope.add(tag);
      warnings.push(`unknown_tag_downgraded:${tag}`);
    }
  });

  uniqueStrings(params.args.excludeTags).forEach((tag) => {
    if (availableTagSet.has(tag)) {
      excludeTags.push(tag);
    } else {
      semanticScope.add(tag);
      warnings.push(`unknown_exclude_tag_downgraded:${tag}`);
    }
  });

  const scope: RetrievalScope = {
    ownerId: params.ownerId,
    query: typeof params.args.query === 'string' ? params.args.query.trim() : '',
    tags: Array.from(new Set(tags)),
    excludeTags: Array.from(new Set(excludeTags)),
    semanticScope: Array.from(semanticScope).slice(0, 30),
    sourceTypes: normalizeSourceTypes(params.args.sourceTypes, warnings),
    timeRange: canonicalizeTimeRange(params.args, warnings),
    lifecycleScope: normalizeLifecycleScope(params.args.lifecycleScope),
    taskStatusScope: normalizeTaskStatusScope(params.args.taskStatusScope),
    limit: clampLimit(params.args.limit),
    cursor:
      typeof params.args.cursor === 'string' && params.args.cursor.trim()
        ? params.args.cursor.trim()
        : null,
    excludeIds: params.excludeIds || [],
  };

  return { scope, warnings };
}

export function toPlannerAgentDto(result: PlannerAgentResult): PlannerAgentDto {
  return {
    originalMessage: result.originalMessage,
    retrievalNeeded: result.retrievalNeeded,
    scope: result.scope,
    toolResult: result.toolResult,
    clarification: result.clarification,
    debugTrace: result.debugTrace,
  };
}

function parseToolArguments(call: ChatToolCall): unknown {
  try {
    return call.function.arguments ? JSON.parse(call.function.arguments) : {};
  } catch {
    return {};
  }
}

function plannerTools(): ChatToolDefinition[] {
  return [
    {
      type: 'function',
      function: {
        name: 'search_rotes',
        description:
          'Probe the current user Rote notes/articles. Use when the answer depends on user memory. Unknown tags will be treated as semantic keywords.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            excludeTags: { type: 'array', items: { type: 'string' } },
            semanticScope: { type: 'array', items: { type: 'string' } },
            sourceTypes: { type: 'array', items: { type: 'string', enum: ['rote', 'article'] } },
            timeRange: {
              type: 'object',
              description:
                'Preferred structured time range. Use this instead of free-text from/to for dates.',
              properties: {
                type: {
                  type: 'string',
                  enum: ['absolute', 'rolling', 'relative_between', 'preset'],
                },
                preset: {
                  type: 'string',
                  enum: ['today', 'yesterday', 'this_month', 'last_month'],
                },
                fromDate: {
                  type: 'string',
                  description:
                    'For absolute ranges only. ISO date/datetime such as 2026-05-08 or 2026-05-08T00:00:00+08:00.',
                },
                toDate: {
                  type: 'string',
                  description:
                    'For absolute ranges only. ISO date/datetime such as 2026-05-09 or 2026-05-09T23:59:59+08:00.',
                },
                amount: { type: 'number', description: 'For rolling ranges, e.g. 7.' },
                unit: {
                  type: 'string',
                  enum: ['day', 'week', 'month', 'year'],
                  description: 'For rolling ranges.',
                },
                fromRelative: {
                  type: 'object',
                  description: 'For relative_between ranges, e.g. 60 days ago.',
                  properties: {
                    amount: { type: 'number' },
                    unit: { type: 'string', enum: ['day', 'week', 'month', 'year'] },
                    direction: { type: 'string', enum: ['ago'] },
                  },
                },
                toRelative: {
                  type: 'object',
                  description: 'For relative_between ranges, e.g. 30 days ago.',
                  properties: {
                    amount: { type: 'number' },
                    unit: { type: 'string', enum: ['day', 'week', 'month', 'year'] },
                    direction: { type: 'string', enum: ['ago'] },
                  },
                },
                label: { type: 'string' },
              },
            },
            timeExpression: {
              type: 'string',
              description:
                'Relative range expression such as today, yesterday, last 7 days, or 最近7天.',
            },
            from: {
              type: 'string',
              description:
                'Absolute ISO date/datetime only, such as 2026-05-08 or 2026-05-08T00:00:00+08:00. Use timeExpression for relative ranges.',
            },
            to: {
              type: 'string',
              description:
                'Absolute ISO date/datetime only, such as 2026-05-09 or 2026-05-09T23:59:59+08:00. Use timeExpression for relative ranges.',
            },
            lifecycleScope: {
              type: 'string',
              enum: ['active', 'archived', 'all', 'unspecified'],
              description: 'Note lifecycle scope only. This maps to archived/unarchived storage.',
            },
            taskStatusScope: {
              type: 'string',
              enum: ['open', 'closed', 'all', 'unspecified'],
              description:
                'Task/open-loop semantic scope only. It is independent from lifecycleScope and does not map to archived.',
            },
            limit: { type: 'number' },
            cursor: { type: 'string' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_tags',
        description: 'List user tags when exact tag filtering is needed.',
        parameters: { type: 'object', properties: { limit: { type: 'number' } } },
      },
    },
    {
      type: 'function',
      function: {
        name: 'finish',
        description:
          'Finish planning. Either use the last search_rotes result, or state that retrieval is not needed.',
        parameters: {
          type: 'object',
          properties: {
            useLastSearch: { type: 'boolean' },
            retrievalNeeded: { type: 'boolean' },
            reason: { type: 'string' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'request_clarification',
        description: 'Ask the user one concise clarification question before retrieval.',
        parameters: {
          type: 'object',
          properties: {
            question: { type: 'string' },
            reason: { type: 'string' },
          },
          required: ['question'],
        },
      },
    },
  ];
}

function buildPlannerSystemPrompt(today: string): string {
  return `You are the Rote retrieval planner. Today is ${today} in Asia/Shanghai.

Use tools only. Decide whether Rote memory is needed, what to probe, whether another probe is needed, or whether to ask a clarification.

Tools:
- search_rotes probes notes/articles and returns canonicalized scope plus lightweight snippets.
- list_tags is only for exact tag decisions.
- finish ends planning; it may only use the last search_rotes result or declare retrievalNeeded=false.
- request_clarification asks a concise user-facing question.

Keep lifecycleScope and taskStatusScope independent. lifecycleScope is note archived/unarchived lifecycle. taskStatusScope is task/open-loop semantics and must not stand in for archived state.
Do not answer the user here.`;
}

function createEmptyTrace(): PlannerDebugTrace {
  return {
    toolCalls: [],
    canonicalizedArgs: [],
    warnings: [],
    probeCounts: [],
  };
}

function noRetrievalResult(
  message: string,
  trace: PlannerDebugTrace,
  reason: string
): PlannerAgentResult {
  return {
    originalMessage: message,
    retrievalNeeded: false,
    scope: null,
    toolResult: null,
    sources: [],
    clarification: null,
    debugTrace: { ...trace, finishReason: reason },
  };
}

export async function createRetrievalPlan(params: {
  ownerId: string;
  message: string;
  config: AiConfig;
  history?: { role: 'user' | 'assistant'; content: string }[];
  executeSearch: SearchRotesProbeExecutor;
  completeWithTools?: typeof createChatCompletionWithToolsStreaming;
  availableTags?: string[];
  excludeIds?: string[];
  getTagCounts?: () => Promise<Array<{ name: string; count: number }>>;
  maxSteps?: number;
  maxToolCalls?: number;
  enableThinking?: boolean;
  onThinkingDelta?: (text: string) => Promise<void> | void;
  onUsage?: (usage: ChatCompletionUsage) => Promise<void> | void;
}): Promise<PlannerAgentResult> {
  const trace = createEmptyTrace();
  const availableTags = params.availableTags || (await getUserRoteTags(params.ownerId));
  const messages: ChatMessage[] = [
    { role: 'system', content: buildPlannerSystemPrompt(toDateString(getShanghaiToday())) },
  ];
  if (params.history?.length) {
    messages.push(
      ...params.history.slice(-8).map((message) => ({
        role: message.role,
        content: message.content,
      }))
    );
  }
  messages.push({ role: 'user', content: params.message });

  let lastSearch: SearchRotesProbeResult | null = null;
  let toolCallCount = 0;
  const toolDefinitions = plannerTools();
  const completeWithTools = params.completeWithTools || createChatCompletionWithToolsStreaming;
  const maxSteps = params.maxSteps ?? MAX_STEPS;
  const maxToolCalls = params.maxToolCalls ?? MAX_TOOL_CALLS;

  for (let step = 0; step < maxSteps; step += 1) {
    let response: Awaited<ReturnType<typeof createChatCompletionWithToolsStreaming>>;
    try {
      response = await completeWithTools(params.config.chat, messages, toolDefinitions, {
        temperature: 0,
        enableThinking: params.enableThinking === true,
        onReasoning: params.onThinkingDelta,
      });
    } catch (error: any) {
      trace.providerError = error?.message || String(error);
      trace.fallbackReason = 'provider_error';
      return noRetrievalResult(params.message, trace, 'provider_error');
    }

    if (response.usage) await params.onUsage?.(response.usage);

    const calls = response.message.tool_calls || [];
    if (!calls.length) {
      trace.fallbackReason = 'assistant_returned_no_tool_call';
      return noRetrievalResult(params.message, trace, 'assistant_returned_no_tool_call');
    }

    messages.push({
      role: 'assistant',
      content: response.message.content || null,
      tool_calls: calls,
    });

    for (const call of calls) {
      if (toolCallCount >= maxToolCalls) {
        trace.fallbackReason = 'tool_call_budget_exceeded';
        return lastSearch
          ? {
              originalMessage: params.message,
              retrievalNeeded: true,
              scope: lastSearch.toolResult.canonicalizedArgs,
              toolResult: lastSearch.toolResult,
              sources: lastSearch.sources,
              clarification: null,
              debugTrace: trace,
            }
          : noRetrievalResult(params.message, trace, 'tool_call_budget_exceeded');
      }
      toolCallCount += 1;
      const args = parseToolArguments(call);
      trace.toolCalls.push({ step, name: call.function.name, args });

      if (call.function.name === 'search_rotes') {
        const { scope, warnings } = canonicalizeSearchRotesArgs({
          ownerId: params.ownerId,
          args: asRecord(args) as SearchRotesArgs,
          availableTags,
          excludeIds: params.excludeIds,
        });
        let probe: SearchRotesProbeResult;
        try {
          probe = await params.executeSearch(scope);
        } catch (error: any) {
          trace.toolError = error?.message || String(error);
          trace.fallbackReason = 'tool_error';
          throw error;
        }
        lastSearch = {
          toolResult: {
            ...probe.toolResult,
            warnings: Array.from(new Set([...warnings, ...probe.toolResult.warnings])),
          },
          sources: probe.sources,
        };
        trace.canonicalizedArgs.push(scope);
        trace.warnings.push(...warnings, ...probe.toolResult.warnings);
        trace.probeCounts.push(probe.toolResult.resultCount);
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(lastSearch.toolResult),
        });
      } else if (call.function.name === 'list_tags') {
        const raw = asRecord(args);
        const limit = clampLimit(raw.limit);
        const tags = (
          await (params.getTagCounts || (() => getUserRoteTagCounts(params.ownerId)))()
        ).slice(0, limit);
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({ status: 'ok', tags }),
        });
      } else if (call.function.name === 'finish') {
        const raw = asRecord(args);
        const reason = typeof raw.reason === 'string' ? raw.reason : 'finish';
        trace.finishReason = reason;
        if (raw.useLastSearch === true && lastSearch) {
          return {
            originalMessage: params.message,
            retrievalNeeded: true,
            scope: lastSearch.toolResult.canonicalizedArgs,
            toolResult: lastSearch.toolResult,
            sources: lastSearch.sources,
            clarification: null,
            debugTrace: trace,
          };
        }
        if (raw.retrievalNeeded === false) {
          return noRetrievalResult(params.message, trace, reason);
        }
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({
            status: 'error',
            message: 'finish must useLastSearch=true after search_rotes or retrievalNeeded=false',
          }),
        });
      } else if (call.function.name === 'request_clarification') {
        const raw = asRecord(args);
        const question =
          typeof raw.question === 'string' && raw.question.trim()
            ? raw.question.trim()
            : 'Can you clarify what you want to search?';
        return {
          originalMessage: params.message,
          retrievalNeeded: false,
          scope: null,
          toolResult: null,
          sources: [],
          clarification: {
            question,
            reason: typeof raw.reason === 'string' ? raw.reason : undefined,
          },
          debugTrace: trace,
        };
      } else {
        trace.warnings.push(`unknown_tool:${call.function.name}`);
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({ status: 'error', message: 'Unknown planner tool' }),
        });
      }
    }
  }

  trace.fallbackReason = 'max_steps_exceeded';
  return lastSearch
    ? {
        originalMessage: params.message,
        retrievalNeeded: true,
        scope: lastSearch.toolResult.canonicalizedArgs,
        toolResult: lastSearch.toolResult,
        sources: lastSearch.sources,
        clarification: null,
        debugTrace: trace,
      }
    : noRetrievalResult(params.message, trace, 'max_steps_exceeded');
}
