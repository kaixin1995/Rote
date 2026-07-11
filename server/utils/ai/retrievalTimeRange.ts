import {
  addDays,
  addMonths,
  addRelativeOffset,
  chineseNumberToInt,
  endOfDay,
  getTodayInTimeContext,
  monthRange,
  startOfDay,
  unitTextToUnit,
} from './retrievalDate';
import { normalizeTimeRangeInput } from './retrievalDateParsing';
import type {
  AiTimeUnit,
  NormalizedTimeRange,
  RetrievalTimeContext,
  SearchRotesArgs,
  StructuredTimeRangePreset,
  StructuredTimeRangeType,
} from './retrievalTypes';

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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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

function normalizeStructuredRelativePoint(
  value: unknown,
  end = false,
  context?: RetrievalTimeContext
): string | null {
  const point = asRecord(value);
  const amount = normalizeStructuredAmount(point.amount);
  const unit = normalizeStructuredTimeUnit(point.unit);
  const direction = typeof point.direction === 'string' ? point.direction.trim() : 'ago';
  if (!amount || !unit || direction !== 'ago') return null;

  const today = getTodayInTimeContext(context);
  const date =
    unit === 'month'
      ? addMonths(today, -amount)
      : unit === 'year'
        ? addMonths(today, -amount * 12)
        : addDays(today, -(unit === 'day' ? amount : amount * 7));
  return end ? endOfDay(date, context) : startOfDay(date, context);
}

function isOrderedTimeRange(from: string, to: string): boolean {
  const fromTime = Date.parse(from);
  const toTime = Date.parse(to);
  return Number.isFinite(fromTime) && Number.isFinite(toTime) && fromTime <= toTime;
}

function canonicalizePresetTimeRange(
  preset: StructuredTimeRangePreset,
  raw: Record<string, unknown>,
  context?: RetrievalTimeContext
): NormalizedTimeRange {
  const today = getTodayInTimeContext(context);
  if (preset === 'today') {
    return {
      from: startOfDay(today, context),
      to: endOfDay(today, context),
      label: structuredLabel(raw, '今天'),
    };
  }
  if (preset === 'yesterday') {
    const yesterday = addDays(today, -1);
    return {
      from: startOfDay(yesterday, context),
      to: endOfDay(yesterday, context),
      label: structuredLabel(raw, '昨天'),
    };
  }
  if (preset === 'this_month') {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    return {
      from: startOfDay(start, context),
      to: endOfDay(today, context),
      label: structuredLabel(raw, '本月'),
    };
  }
  const range = monthRange(today.getUTCFullYear(), today.getUTCMonth() - 1, '上个月', context);
  return { ...range, label: structuredLabel(raw, range.label) };
}

function canonicalizeStructuredTimeRange(
  value: unknown,
  context?: RetrievalTimeContext
): NormalizedTimeRange | null {
  const raw = asRecord(value);
  if (!Object.keys(raw).length) return null;

  const type = VALID_STRUCTURED_TIME_TYPES.has(raw.type as StructuredTimeRangeType)
    ? (raw.type as StructuredTimeRangeType)
    : undefined;
  const preset = VALID_STRUCTURED_TIME_PRESETS.has(raw.preset as StructuredTimeRangePreset)
    ? (raw.preset as StructuredTimeRangePreset)
    : undefined;

  const parsePreset = () => (preset ? canonicalizePresetTimeRange(preset, raw, context) : null);
  const parseRolling = () => {
    const amount = normalizeStructuredAmount(raw.amount);
    const unit = normalizeStructuredTimeUnit(raw.unit);
    if (!amount || !unit) return null;
    const today = getTodayInTimeContext(context);
    const start =
      unit === 'month'
        ? addMonths(today, -amount)
        : unit === 'year'
          ? addMonths(today, -amount * 12)
          : addDays(today, -(unit === 'day' ? amount : amount * 7));
    return {
      from: startOfDay(start, context),
      to: endOfDay(today, context),
      label: structuredLabel(raw, `last ${amount} ${unit}${amount === 1 ? '' : 's'}`),
    };
  };
  const parseRelativeBetween = () => {
    const from = normalizeStructuredRelativePoint(raw.fromRelative, false, context);
    const to = normalizeStructuredRelativePoint(raw.toRelative, true, context);
    if (!from || !to || !isOrderedTimeRange(from, to)) return null;
    return {
      from,
      to,
      label: structuredLabel(
        raw,
        `${formatRelativePointLabel(asRecord(raw.fromRelative))} 到 ${formatRelativePointLabel(asRecord(raw.toRelative))}`
      ),
    };
  };
  const parseAbsolute = () =>
    normalizeTimeRangeInput({ from: raw.fromDate, to: raw.toDate, label: raw.label }, context);

  if (type === 'absolute') return parseAbsolute();
  if (type === 'rolling') return parseRolling();
  if (type === 'relative_between') return parseRelativeBetween();
  if (type === 'preset') return parsePreset();
  if (preset) return parsePreset();
  if (raw.fromRelative || raw.toRelative) return parseRelativeBetween();
  if (raw.amount !== undefined || raw.unit !== undefined) return parseRolling();
  if (raw.fromDate !== undefined || raw.toDate !== undefined) return parseAbsolute();
  return null;
}

export function canonicalizeTimeRange(
  args: SearchRotesArgs,
  warnings?: string[],
  context?: RetrievalTimeContext
): NormalizedTimeRange | null {
  if (args.timeRange !== undefined) {
    const structured = canonicalizeStructuredTimeRange(args.timeRange, context);
    if (structured) return structured;
    warnings?.push('invalid_time_range_ignored');
  }

  const from = typeof args.from === 'string' ? args.from.trim() : '';
  const to = typeof args.to === 'string' ? args.to.trim() : '';
  if (from && to) {
    const normalized = normalizeTimeRangeInput({ from, to, label: `${from} 到 ${to}` }, context);
    if (!normalized) warnings?.push('invalid_time_range_ignored');
    return normalized;
  }

  const expression = typeof args.timeExpression === 'string' ? args.timeExpression.trim() : '';
  if (!expression) return null;

  const today = getTodayInTimeContext(context);
  if (/今天|今日|today/i.test(expression)) {
    return { from: startOfDay(today, context), to: endOfDay(today, context), label: '今天' };
  }
  if (/昨天|昨日|yesterday/i.test(expression)) {
    const yesterday = addDays(today, -1);
    return {
      from: startOfDay(yesterday, context),
      to: endOfDay(yesterday, context),
      label: '昨天',
    };
  }
  if (/本月|这个月|this month/i.test(expression)) {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    return { from: startOfDay(start, context), to: endOfDay(today, context), label: '本月' };
  }
  if (/上个月|上月|last month/i.test(expression)) {
    return monthRange(today.getUTCFullYear(), today.getUTCMonth() - 1, '上个月', context);
  }

  const rollingMatch = expression.match(
    /(?:最近|近|过去|前|last|past|previous|recent)\s*(\d+|[一二两三四五六七八九十]+)\s*(天|日|周|星期|个月|月|年|days?|weeks?|months?|years?)/i
  );
  if (rollingMatch) {
    const normalizedAmount = chineseNumberToInt(rollingMatch[1]);
    if (normalizedAmount) {
      const offsetUnit = unitTextToUnit(rollingMatch[2]);
      const start = addRelativeOffset(today, normalizedAmount, offsetUnit);
      return {
        from: startOfDay(start, context),
        to: endOfDay(today, context),
        label: rollingMatch[0],
      };
    }
  }

  const explicitRange = expression.match(
    /(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})\s*(?:到|至|~|-|—)\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/
  );
  if (explicitRange) {
    const normalized = normalizeTimeRangeInput(
      { from: explicitRange[1], to: explicitRange[2], label: explicitRange[0] },
      context
    );
    if (!normalized) warnings?.push('invalid_time_range_ignored');
    return normalized;
  }

  return null;
}
