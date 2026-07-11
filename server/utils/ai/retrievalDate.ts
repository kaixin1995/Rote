import type { AiTimeUnit, NormalizedTimeRange, RetrievalTimeContext } from './retrievalTypes';

const DEFAULT_TIME_ZONE = 'Asia/Shanghai';
const DEFAULT_UTC_OFFSET_MINUTES = 8 * 60;
const RELATIVE_POINT_RE =
  /^(\d+|[一二两三四五六七八九十]+)\s*(天|日|周|星期|个月|月|年|days?|weeks?|months?|years?)\s*ago$/i;
const RELATIVE_POINT_ZH_RE = /^(\d+|[一二两三四五六七八九十]+)\s*(天|日|周|星期|个月|月|年)前$/;

export function normalizeTimeZone(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return DEFAULT_TIME_ZONE;
  const timeZone = value.trim();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0));
    return timeZone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

function parseReferenceNow(context?: RetrievalTimeContext): Date {
  const raw = context?.nowIso || context?.localDateTime;
  if (raw) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

export function isValidDateParts(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) return false;
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Number.isInteger(day) && day >= 1 && day <= maxDay;
}

function parseLocalDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidDateParts(year, month, day)) return null;

  return new Date(Date.UTC(year, month - 1, day));
}

function getDatePartsInTimeZone(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

export function getTodayInTimeContext(context?: RetrievalTimeContext): Date {
  const localDate = parseLocalDate(context?.localDate);
  if (localDate) return localDate;

  const timeZone = normalizeTimeZone(context?.timeZone);
  const { year, month, day } = getDatePartsInTimeZone(parseReferenceNow(context), timeZone);
  return new Date(Date.UTC(year, month - 1, day));
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function toDateString(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function formatOffset(minutes: number): string {
  const sign = minutes >= 0 ? '+' : '-';
  const absolute = Math.abs(minutes);
  return `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number | null {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const parts = Object.fromEntries(
      formatter.formatToParts(date).map((part) => [part.type, part.value])
    );
    const zonedAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second)
    );
    return Math.round((zonedAsUtc - date.getTime()) / 60_000);
  } catch {
    return null;
  }
}

function offsetForCalendarDate(date: Date, context?: RetrievalTimeContext): string {
  const timeZone = normalizeTimeZone(context?.timeZone);
  const noonUtc = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12)
  );
  const offsetMinutes =
    getTimeZoneOffsetMinutes(noonUtc, timeZone) ??
    (Number.isFinite(context?.utcOffsetMinutes)
      ? Math.trunc(context?.utcOffsetMinutes as number)
      : DEFAULT_UTC_OFFSET_MINUTES);
  return formatOffset(offsetMinutes);
}

export function startOfDay(date: Date, context?: RetrievalTimeContext): string {
  return `${toDateString(date)}T00:00:00${offsetForCalendarDate(date, context)}`;
}

export function endOfDay(date: Date, context?: RetrievalTimeContext): string {
  return `${toDateString(date)}T23:59:59${offsetForCalendarDate(date, context)}`;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const maxDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, maxDay));
  return next;
}

export function monthRange(
  year: number,
  monthIndex: number,
  label: string,
  context?: RetrievalTimeContext
): NormalizedTimeRange {
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 0));
  return { from: startOfDay(start, context), to: endOfDay(end, context), label };
}

export function isValidTimeParts(hour: number, minute: number, second: number): boolean {
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

export function isValidTimezoneOffset(value: string): boolean {
  if (value === 'Z') return true;
  const match = value.match(/^([+-])(\d{2}):(\d{2})$/);
  if (!match) return false;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

export function chineseNumberToInt(value: string): number | null {
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

export function unitTextToUnit(value: string): AiTimeUnit {
  const unitText = value.toLowerCase();
  return unitText === '天' || unitText === '日' || unitText.startsWith('day')
    ? 'day'
    : unitText === '周' || unitText === '星期' || unitText.startsWith('week')
      ? 'week'
      : unitText === '年' || unitText.startsWith('year')
        ? 'year'
        : 'month';
}

export function addRelativeOffset(date: Date, amount: number, unit: AiTimeUnit): Date {
  if (unit === 'month') return addMonths(date, -amount);
  if (unit === 'year') return addMonths(date, -amount * 12);
  return addDays(date, -(unit === 'day' ? amount : amount * 7));
}

export function parseRelativePointDate(value: string, context?: RetrievalTimeContext): Date | null {
  const match = value.trim().match(RELATIVE_POINT_RE) || value.trim().match(RELATIVE_POINT_ZH_RE);
  if (!match) return null;

  const amount = chineseNumberToInt(match[1]);
  if (!amount || amount > 10000) return null;
  return addRelativeOffset(getTodayInTimeContext(context), amount, unitTextToUnit(match[2]));
}
