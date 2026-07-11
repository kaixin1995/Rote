import { sql } from 'drizzle-orm';
import { rotes } from '../../drizzle/schema';
import db from '../drizzle';
import { canonicalizeTimeRange } from './retrievalTimeRange';
import type {
  AiSourceType,
  LifecycleScope,
  RetrievalDateField,
  RetrievalScope,
  RetrievalSelection,
  RetrievalTimeContext,
  SearchRotesArgs,
  TaskStatusScope,
} from './retrievalTypes';

const VALID_SOURCE_TYPES = new Set<AiSourceType>(['rote', 'article']);
const VALID_RETRIEVAL_SELECTIONS = new Set<RetrievalSelection>(['relevance', 'recent']);
const VALID_RETRIEVAL_DATE_FIELDS = new Set<RetrievalDateField>(['createdAt', 'updatedAt']);
const VALID_LIFECYCLE_SCOPES = new Set<LifecycleScope>([
  'active',
  'archived',
  'all',
  'unspecified',
]);
const VALID_TASK_STATUS_SCOPES = new Set<TaskStatusScope>(['open', 'closed', 'all', 'unspecified']);
const DEFAULT_LIMIT = 15;
const DEFAULT_RECENT_LIMIT = 30;
const MAX_LIMIT = 50;

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

function clampLimit(value: unknown, fallback = DEFAULT_LIMIT): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(Math.floor(numeric), 1), MAX_LIMIT);
}

function normalizeSourceTypes(value: unknown, warnings: string[]): AiSourceType[] {
  if (!Array.isArray(value)) return ['rote', 'article'];
  const valid = uniqueStrings(value)
    .filter((type): type is AiSourceType => VALID_SOURCE_TYPES.has(type as AiSourceType))
    .slice(0, 2);
  uniqueStrings(value)
    .filter((type) => !VALID_SOURCE_TYPES.has(type as AiSourceType))
    .forEach((type) => warnings.push(`invalid_source_type:${type}`));
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

function normalizeRetrievalSelection(
  value: unknown,
  warnings: string[]
): RetrievalSelection | null {
  if (value === undefined) return null;
  if (VALID_RETRIEVAL_SELECTIONS.has(value as RetrievalSelection)) {
    return value as RetrievalSelection;
  }
  warnings.push(`invalid_selection:${String(value)}`);
  return null;
}

function normalizeRetrievalDateField(
  value: unknown,
  warnings: string[]
): RetrievalDateField | null {
  if (value === undefined) return null;
  if (VALID_RETRIEVAL_DATE_FIELDS.has(value as RetrievalDateField)) {
    return value as RetrievalDateField;
  }
  warnings.push(`invalid_date_field:${String(value)}`);
  return null;
}

function hasRecentLanguage(message?: string): boolean {
  return /最近|近期|最新|近来|recent|latest/i.test(message || '');
}

function hasBroadRecentAnalysis(message?: string): boolean {
  return /主题|趋势|重复|反复|模式|总结|themes?|trends?|patterns?|review/i.test(message || '');
}

function inferDateField(message?: string): RetrievalDateField {
  return /修改|更新|活动|改过|updated|modified|activity/i.test(message || '')
    ? 'updatedAt'
    : 'createdAt';
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

export function canonicalizeSearchRotesArgs(params: {
  ownerId: string;
  args: SearchRotesArgs;
  availableTags: string[];
  message?: string;
  excludeIds?: string[];
  timeContext?: RetrievalTimeContext | null;
}): { scope: RetrievalScope; warnings: string[] } {
  const warnings: string[] = [];
  const availableTagSet = new Set(params.availableTags);
  const semanticScope = new Set(uniqueStrings(params.args.semanticScope));
  const tags: string[] = [];
  const excludeTags: string[] = [];

  uniqueStrings(params.args.tags).forEach((tag) => {
    if (availableTagSet.has(tag)) tags.push(tag);
    else {
      semanticScope.add(tag);
      warnings.push(`unknown_tag_downgraded:${tag}`);
    }
  });
  uniqueStrings(params.args.excludeTags).forEach((tag) => {
    if (availableTagSet.has(tag)) excludeTags.push(tag);
    else {
      semanticScope.add(tag);
      warnings.push(`unknown_exclude_tag_downgraded:${tag}`);
    }
  });

  const timeRange = canonicalizeTimeRange(params.args, warnings, params.timeContext || undefined);
  const requestedSelection = normalizeRetrievalSelection(params.args.selection, warnings);
  const recentSafetyRequired =
    hasRecentLanguage(params.message) && (!timeRange || hasBroadRecentAnalysis(params.message));
  const selection = recentSafetyRequired ? 'recent' : requestedSelection || 'relevance';
  const requestedDateField = normalizeRetrievalDateField(params.args.dateField, warnings);
  const dateField = requestedDateField || inferDateField(params.message);
  const defaultLimit =
    selection === 'recent' && params.args.limit === undefined
      ? DEFAULT_RECENT_LIMIT
      : DEFAULT_LIMIT;

  return {
    scope: {
      ownerId: params.ownerId,
      query: typeof params.args.query === 'string' ? params.args.query.trim() : '',
      tags: Array.from(new Set(tags)),
      excludeTags: Array.from(new Set(excludeTags)),
      semanticScope: Array.from(semanticScope).slice(0, 30),
      sourceTypes: normalizeSourceTypes(params.args.sourceTypes, warnings),
      timeRange,
      selection,
      dateField,
      lifecycleScope: normalizeLifecycleScope(params.args.lifecycleScope),
      taskStatusScope: normalizeTaskStatusScope(params.args.taskStatusScope),
      limit: clampLimit(params.args.limit, defaultLimit),
      cursor:
        typeof params.args.cursor === 'string' && params.args.cursor.trim()
          ? params.args.cursor.trim()
          : null,
      excludeIds: params.excludeIds || [],
    },
    warnings,
  };
}
