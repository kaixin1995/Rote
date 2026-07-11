import {
  endOfDay,
  isValidDateParts,
  isValidTimeParts,
  isValidTimezoneOffset,
  parseRelativePointDate,
  startOfDay,
} from './retrievalDate';
import type { NormalizedTimeRange, RetrievalTimeContext } from './retrievalTypes';

const DATE_ONLY_RE = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/;
const ISO_DATE_TIME_WITH_ZONE_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeDateOnlyInput(
  value: string,
  end = false,
  context?: RetrievalTimeContext
): string | null {
  const match = value.trim().match(DATE_ONLY_RE);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidDateParts(year, month, day)) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  return end ? endOfDay(date, context) : startOfDay(date, context);
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

function normalizeDateInput(
  value: string,
  end = false,
  context?: RetrievalTimeContext
): string | null {
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.includes('T')) return normalizeIsoDateTimeInput(normalized);

  const dateOnly = normalizeDateOnlyInput(normalized, end, context);
  if (dateOnly) return dateOnly;

  const relativePoint = parseRelativePointDate(normalized, context);
  if (relativePoint)
    return end ? endOfDay(relativePoint, context) : startOfDay(relativePoint, context);

  return null;
}

function isOrderedTimeRange(from: string, to: string): boolean {
  const fromTime = Date.parse(from);
  const toTime = Date.parse(to);
  return Number.isFinite(fromTime) && Number.isFinite(toTime) && fromTime <= toTime;
}

export function normalizeTimeRangeInput(
  value: unknown,
  context?: RetrievalTimeContext
): NormalizedTimeRange | null {
  const raw = asRecord(value);
  const from = typeof raw.from === 'string' ? raw.from.trim() : '';
  const to = typeof raw.to === 'string' ? raw.to.trim() : '';
  if (!from || !to) return null;

  const normalizedFrom = normalizeDateInput(from, false, context);
  const normalizedTo = normalizeDateInput(to, true, context);
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
