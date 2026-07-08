import { sql } from 'drizzle-orm';
import {
  buildTextArraySql,
  normalizeLimit,
  normalizeSearchTimeRange,
  VALID_SOURCE_TYPES,
} from './documents';
import db from '../../drizzle';
import { semanticSearch } from './semanticSearch';
import type { AiSourceType, NormalizedTimeRange, SemanticSearchResult } from './types';

function extractTextSearchTerms(...values: Array<string | string[] | undefined>): string[] {
  const text = values.flat().filter(Boolean).join(' ');
  const terms = text.match(/[\p{L}\p{N}_]{2,}/gu) || [];
  return Array.from(new Set(terms.map((term) => term.trim()).filter(Boolean))).slice(0, 8);
}

function maybeDateString(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : undefined;
}

function buildTextSearchResult(row: any, sourceType: AiSourceType, similarity: number) {
  if (sourceType === 'rote') {
    const text = `Title: ${row.title || ''}\nTags: ${(row.tags || []).join(', ')}\n${row.content || ''}`;
    return {
      id: `text:${sourceType}:${row.id}`,
      ownerId: row.ownerId,
      sourceType,
      sourceId: row.id,
      chunkIndex: 0,
      text,
      similarity,
      metadata: {
        title: row.title || '',
        tags: row.tags || [],
        state: row.state,
        archived: row.archived,
        createdAt: maybeDateString(row.createdAt),
        updatedAt: maybeDateString(row.updatedAt),
      },
    } satisfies SemanticSearchResult;
  }

  return {
    id: `text:${sourceType}:${row.id}`,
    ownerId: row.ownerId,
    sourceType,
    sourceId: row.id,
    chunkIndex: 0,
    text: row.content || '',
    similarity,
    metadata: {
      createdAt: maybeDateString(row.createdAt),
      updatedAt: maybeDateString(row.updatedAt),
    },
  } satisfies SemanticSearchResult;
}

function buildRoteTextTermSql(terms: string[]) {
  if (!terms.length) return sql``;
  const clauses = terms.map((term) => {
    const pattern = `%${term}%`;
    return sql`(
      r."title" ILIKE ${pattern}
      OR r."content" ILIKE ${pattern}
      OR EXISTS (
        SELECT 1 FROM unnest(COALESCE(r."tags", ARRAY[]::text[])) AS tag
        WHERE tag ILIKE ${pattern}
      )
    )`;
  });
  return sql`AND (${sql.join(clauses, sql` OR `)})`;
}

function buildArticleTextTermSql(terms: string[]) {
  if (!terms.length) return sql``;
  const clauses = terms.map((term) => {
    const pattern = `%${term}%`;
    return sql`a."content" ILIKE ${pattern}`;
  });
  return sql`AND (${sql.join(clauses, sql` OR `)})`;
}

function buildTextSearchTimeSql(alias: 'r' | 'a', timeRange?: NormalizedTimeRange | null) {
  if (!timeRange) return sql``;
  return alias === 'r'
    ? sql`AND r."createdAt" >= ${timeRange.from}::timestamptz AND r."createdAt" <= ${timeRange.to}::timestamptz`
    : sql`AND a."createdAt" >= ${timeRange.from}::timestamptz AND a."createdAt" <= ${timeRange.to}::timestamptz`;
}

export async function textSearchMemory(params: {
  query: string;
  ownerId?: string;
  sourceTypes?: AiSourceType[];
  timeRange?: NormalizedTimeRange | null;
  tags?: { include?: string[]; exclude?: string[]; match?: 'any' | 'all' };
  semanticScope?: string[];
  state?: 'private' | 'public' | 'all';
  archived?: boolean | null;
  limit?: number;
  exclude?: { sourceType: AiSourceType; sourceId: string };
  excludeIds?: string[];
}): Promise<SemanticSearchResult[]> {
  if (!params.ownerId) return [];
  const limit = normalizeLimit(params.limit);
  const { timeRange } = normalizeSearchTimeRange(params.timeRange);
  const sourceTypes = new Set(
    (params.sourceTypes || ['rote', 'article']).filter((type) => VALID_SOURCE_TYPES.has(type))
  );
  const terms = extractTextSearchTerms(params.query, params.semanticScope);
  const runSearch = async (activeTerms: string[]) => {
    const results: SemanticSearchResult[] = [];
    const excludeRoteIds = [
      ...(params.exclude?.sourceType === 'rote' ? [params.exclude.sourceId] : []),
      ...((params.excludeIds || [])
        .filter((id) => id.startsWith('rote:'))
        .map((id) => id.slice('rote:'.length)) || []),
    ];
    const excludeArticleIds = [
      ...(params.exclude?.sourceType === 'article' ? [params.exclude.sourceId] : []),
      ...((params.excludeIds || [])
        .filter((id) => id.startsWith('article:'))
        .map((id) => id.slice('article:'.length)) || []),
    ];

    if (sourceTypes.has('rote')) {
      const includeTags = params.tags?.include?.filter(Boolean) || [];
      const excludeTags = params.tags?.exclude?.filter(Boolean) || [];
      const includeTagsSql =
        includeTags.length > 0
          ? params.tags?.match === 'all'
            ? sql`AND r."tags" @> ${buildTextArraySql(includeTags)}`
            : sql`AND r."tags" && ${buildTextArraySql(includeTags)}`
          : sql``;
      const excludeTagsSql =
        excludeTags.length > 0
          ? sql`AND NOT (r."tags" && ${buildTextArraySql(excludeTags)})`
          : sql``;
      const stateSql =
        params.state && params.state !== 'all' ? sql`AND r."state" = ${params.state}` : sql``;
      const archivedSql =
        typeof params.archived === 'boolean' ? sql`AND r."archived" = ${params.archived}` : sql``;
      const excludeSql =
        excludeRoteIds.length > 0
          ? sql`AND NOT (r."id" = ANY(${buildTextArraySql(excludeRoteIds)}))`
          : sql``;
      const rows = (await db.execute(sql`
        SELECT
          r."id",
          r."authorid" AS "ownerId",
          r."title",
          r."content",
          r."tags",
          r."state",
          r."archived",
          r."createdAt",
          r."updatedAt"
        FROM "rotes" r
        WHERE r."authorid" = ${params.ownerId}
          ${buildRoteTextTermSql(activeTerms)}
          ${includeTagsSql}
          ${excludeTagsSql}
          ${stateSql}
          ${archivedSql}
          ${buildTextSearchTimeSql('r', timeRange)}
          ${excludeSql}
        ORDER BY r."updatedAt" DESC
        LIMIT ${limit}
      `)) as any[];
      results.push(...rows.map((row) => buildTextSearchResult(row, 'rote', 0.2)));
    }

    if (
      sourceTypes.has('article') &&
      !params.tags?.include?.length &&
      !params.tags?.exclude?.length
    ) {
      const excludeSql =
        excludeArticleIds.length > 0
          ? sql`AND NOT (a."id" = ANY(${buildTextArraySql(excludeArticleIds)}))`
          : sql``;
      const rows = (await db.execute(sql`
        SELECT
          a."id",
          a."authorId" AS "ownerId",
          a."content",
          a."createdAt",
          a."updatedAt"
        FROM "articles" a
        WHERE a."authorId" = ${params.ownerId}
          ${buildArticleTextTermSql(activeTerms)}
          ${buildTextSearchTimeSql('a', timeRange)}
          ${excludeSql}
        ORDER BY a."updatedAt" DESC
        LIMIT ${limit}
      `)) as any[];
      results.push(...rows.map((row) => buildTextSearchResult(row, 'article', 0.15)));
    }

    return results
      .sort((a, b) => {
        const aTime = Date.parse(String(a.metadata?.updatedAt || a.metadata?.createdAt || ''));
        const bTime = Date.parse(String(b.metadata?.updatedAt || b.metadata?.createdAt || ''));
        return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
      })
      .slice(0, limit);
  };

  const matched = await runSearch(terms);
  return matched.length || terms.length === 0 ? matched : runSearch([]);
}

export async function searchMemoryWithFallback(params: {
  query: string;
  ownerId?: string;
  scope?: 'mine' | 'public';
  sourceTypes?: AiSourceType[];
  timeRange?: NormalizedTimeRange | null;
  tags?: { include?: string[]; exclude?: string[]; match?: 'any' | 'all' };
  semanticScope?: string[];
  state?: 'private' | 'public' | 'all';
  archived?: boolean | null;
  limit?: number;
  exclude?: { sourceType: AiSourceType; sourceId: string };
  excludeIds?: string[];
}): Promise<{ sources: SemanticSearchResult[]; warnings: string[] }> {
  const { timeRange, warnings } = normalizeSearchTimeRange(params.timeRange);
  const safeParams = { ...params, timeRange };
  try {
    return { sources: await semanticSearch(safeParams), warnings };
  } catch (error: any) {
    if (params.scope === 'public') throw error;
    return {
      sources: await textSearchMemory(safeParams),
      warnings: [...warnings, 'semantic_search_fallback_text'],
    };
  }
}
