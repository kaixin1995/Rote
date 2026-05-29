import { createHash } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  articles,
  documentEmbeddings,
  embeddingJobs,
  rotes,
  users,
  type EmbeddingJob,
} from '../../drizzle/schema';
import type { AiConfig, SecurityConfig } from '../../types/config';
import {
  createChatCompletion,
  createEmbedding,
  vectorToLiteral,
  type ChatCompletionUsage,
  type ChatMessage,
} from '../ai/client';
import { DEFAULT_AI_CONFIG, mergeAiConfig } from '../ai/providers';
import {
  createDefaultFilters,
  createRetrievalPlan,
  getUserRoteTags,
  type AiRetrievalFilters,
  type AiRetrievalPlan,
  type AiNormalizedTimeRange,
} from '../ai/retrievalPlan';
import { getConfig, getGlobalConfig, setConfig } from '../config';
import db from '../drizzle';
import { logAiTokenUsage } from './aiToken';
import { DatabaseError } from './common';

export type AiSourceType = 'rote' | 'article';
export type EmbeddingJobAction = 'upsert' | 'delete' | 'reindex';
export type EmbeddingJobStatus = 'pending' | 'running' | 'succeeded' | 'failed';
export type { AiRetrievalFilters, AiRetrievalPlan, AiNormalizedTimeRange };

export interface SemanticSearchResult {
  id: string;
  ownerId: string;
  sourceType: AiSourceType;
  sourceId: string;
  chunkIndex: number;
  text: string;
  similarity: number;
  metadata: any;
}

const VALID_SOURCE_TYPES = new Set<AiSourceType>(['rote', 'article']);
const MAX_VECTOR_SEARCH_LIMIT = 50;
const DEFAULT_CHAT_LIMIT = 15;
const DEFAULT_EVIDENCE_CONTEXT_BUDGET = 16_000;
const DEFAULT_EVIDENCE_SNIPPET_LENGTH = 900;
const MAX_EVIDENCE_SOURCE_COUNT = 18;
const MIN_DEEP_SAMPLE_SIZE = 8;
const MIN_COMPARISON_GROUP_SAMPLE_SIZE = 3;
const LEGACY_NEEDS_MORE_TAG = '<needs_more/>';

export type EvidenceSampleStatus = 'no_evidence' | 'limited_sample' | 'adequate';

export interface RetrievalContextDiagnostics {
  candidateCount: number;
  contextSourceCount: number;
  omittedSourceCount: number;
  minUsefulSourceCount: number;
  sampleStatus: EvidenceSampleStatus;
  groupStats: Array<{
    label: string;
    candidateCount: number;
    contextSourceCount: number;
    sampleStatus: EvidenceSampleStatus;
  }>;
}

function getRuntimeAiConfig(): AiConfig {
  return mergeAiConfig(getGlobalConfig<AiConfig>('ai') || DEFAULT_AI_CONFIG);
}

export async function getStoredAiConfig(): Promise<AiConfig> {
  return mergeAiConfig(await getConfig<AiConfig>('ai'));
}

export async function updateStoredAiConfig(config: AiConfig): Promise<boolean> {
  return setConfig('ai', mergeAiConfig(config), {
    isRequired: false,
    isSystem: false,
    isInitialized: true,
  });
}

function isVectorUsable(config = getRuntimeAiConfig()): boolean {
  return config.enabled === true && config.vectorEnabled === true;
}

function shouldAutoIndex(config = getRuntimeAiConfig()): boolean {
  return isVectorUsable(config) && config.autoIndexEnabled === true;
}

export async function isAiEligibleUser(userId: string): Promise<boolean> {
  const [user] = await db
    .select({ emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return user?.emailVerified === true;
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeEmbeddingDimensions(value: number): number {
  const dimensions = Number(value);
  if (!Number.isInteger(dimensions) || dimensions <= 0 || dimensions > 4000) {
    throw new Error('Embedding dimensions must be an integer between 1 and 4000');
  }
  return dimensions;
}

function normalizeLimit(limit?: number): number {
  if (!limit || Number.isNaN(limit)) return 10;
  return Math.min(Math.max(Math.floor(limit), 1), MAX_VECTOR_SEARCH_LIMIT);
}

function buildTextArraySql(values: string[]) {
  return sql`ARRAY[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `
  )}]::text[]`;
}

function vectorIndexName(dimensions: number): string {
  return `document_embeddings_embedding_hnsw_${dimensions}_idx`;
}

function isDeepAnalysisPlan(plan: AiRetrievalPlan): boolean {
  const deepOperations = new Set([
    'analyze_personality',
    'analyze_mood',
    'analyze_stress',
    'find_open_loops',
    'timeline',
    'compare',
  ]);
  return plan.operations.some((operation) => deepOperations.has(operation));
}

function resolveRetrievalLimit(plan: AiRetrievalPlan, requestedLimit?: number): number {
  const baseLimit = requestedLimit || DEFAULT_CHAT_LIMIT;
  return isDeepAnalysisPlan(plan) ? Math.max(baseLimit, 40) : baseLimit;
}

function getMinUsefulSourceCount(plan: AiRetrievalPlan): number {
  if (plan.comparison?.groups.length) {
    return plan.comparison.groups.length * MIN_COMPARISON_GROUP_SAMPLE_SIZE;
  }
  return isDeepAnalysisPlan(plan) ? MIN_DEEP_SAMPLE_SIZE : 1;
}

function classifySampleStatus(count: number, minUsefulCount: number): EvidenceSampleStatus {
  if (count <= 0) return 'no_evidence';
  return count < minUsefulCount ? 'limited_sample' : 'adequate';
}

function stripLegacyNeedsMoreTag(text: string): string {
  const trimmed = text.trimStart();
  return trimmed.startsWith(LEGACY_NEEDS_MORE_TAG)
    ? trimmed.slice(LEGACY_NEEDS_MORE_TAG.length).trimStart()
    : text;
}

function fallbackAnswer(sources: SemanticSearchResult[]): string {
  if (sources.length === 0) {
    return 'No matching Rote memory was found for this question, so I cannot answer from your notes yet.';
  }
  return 'I found related Rote memory, but the model did not return a usable answer. Please try again or narrow the scope.';
}

function formatEvidenceDate(value: unknown): string | null {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().slice(0, 10);
}

function formatEvidenceTags(tags: unknown): string {
  return Array.isArray(tags) && tags.length ? tags.map((tag) => `#${tag}`).join(' ') : '';
}

function buildEvidenceBlock(
  source: SemanticSearchResult,
  index: number,
  maxSnippetLength: number,
  groupLabels: string[] = []
): string {
  const date = formatEvidenceDate(source.metadata?.createdAt);
  const tags = formatEvidenceTags(source.metadata?.tags);
  const meta = [
    `Type: ${source.sourceType}`,
    groupLabels.length ? `Groups: ${groupLabels.join(', ')}` : '',
    source.sourceType === 'rote' ? `State: ${source.metadata?.state || 'unknown'}` : '',
    source.sourceType === 'rote'
      ? `Archived: ${source.metadata?.archived === true ? 'true (closed/completed)' : 'false'}`
      : '',
    date ? `Date: ${date}` : '',
    tags ? `Tags: ${tags}` : '',
    `Similarity: ${source.similarity.toFixed(3)}`,
  ]
    .filter(Boolean)
    .join('\n');
  return `[${index}] ${source.sourceType}:${source.sourceId}\n${meta}\nExcerpt:\n${source.text
    .slice(0, maxSnippetLength)
    .trim()}`;
}

async function logChatTokenUsage(
  ownerId: string,
  model: string,
  usage: ChatCompletionUsage
): Promise<void> {
  await logAiTokenUsage({
    userid: ownerId,
    model,
    type: 'chat',
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  });
}

function splitIntoChunks(text: string, chunkSize: number, overlap: number): string[] {
  const cleanText = text.replace(/\r\n/g, '\n').trim();
  if (!cleanText) return [];

  const size = Math.max(500, chunkSize || DEFAULT_AI_CONFIG.indexing.chunkSize);
  const safeOverlap = Math.min(Math.max(overlap || 0, 0), Math.floor(size / 2));
  const chunks: string[] = [];
  let start = 0;

  while (start < cleanText.length) {
    const end = Math.min(start + size, cleanText.length);
    chunks.push(cleanText.slice(start, end).trim());
    if (end >= cleanText.length) break;
    start = Math.max(end - safeOverlap, start + 1);
  }

  return chunks.filter(Boolean);
}

function buildRoteDocument(rote: any): { text: string; metadata: any } {
  const title = rote.title ? `Title: ${rote.title}\n` : '';
  const tags =
    Array.isArray(rote.tags) && rote.tags.length ? `Tags: ${rote.tags.join(', ')}\n` : '';
  return {
    text: `${title}${tags}${rote.content || ''}`.trim(),
    metadata: {
      title: rote.title || '',
      tags: rote.tags || [],
      state: rote.state,
      archived: rote.archived,
      createdAt: rote.createdAt,
      updatedAt: rote.updatedAt,
    },
  };
}

function buildArticleDocument(article: any): { text: string; metadata: any } {
  return {
    text: article.content || '',
    metadata: {
      createdAt: article.createdAt,
      updatedAt: article.updatedAt,
    },
  };
}

async function getSourceDocument(sourceType: AiSourceType, sourceId: string): Promise<any | null> {
  if (sourceType === 'rote') {
    return db.query.rotes.findFirst({
      where: (tbl, { eq }) => eq(tbl.id, sourceId),
    });
  }

  return db.query.articles.findFirst({
    where: (tbl, { eq }) => eq(tbl.id, sourceId),
  });
}

function getSourceOwner(sourceType: AiSourceType, source: any): string {
  return sourceType === 'rote' ? source.authorid : source.authorId;
}

function buildSourceDocument(
  sourceType: AiSourceType,
  source: any
): { text: string; metadata: any } {
  return sourceType === 'rote' ? buildRoteDocument(source) : buildArticleDocument(source);
}

async function sourceNeedsEmbeddingBackfill(
  sourceType: AiSourceType,
  source: any,
  config: AiConfig
): Promise<boolean> {
  const document = buildSourceDocument(sourceType, source);
  const chunks = splitIntoChunks(
    document.text,
    config.indexing.chunkSize,
    config.indexing.chunkOverlap
  );
  const expectedDimensions = normalizeEmbeddingDimensions(config.embedding.dimensions);
  const sourceId = source.id;
  const rows = await db
    .select({
      chunkIndex: documentEmbeddings.chunkIndex,
      contentHash: documentEmbeddings.contentHash,
      embeddingModel: documentEmbeddings.embeddingModel,
      embeddingDimensions: documentEmbeddings.embeddingDimensions,
    })
    .from(documentEmbeddings)
    .where(
      and(eq(documentEmbeddings.sourceType, sourceType), eq(documentEmbeddings.sourceId, sourceId))
    );

  if (chunks.length === 0) {
    return rows.length > 0;
  }

  if (rows.length !== chunks.length) {
    return true;
  }

  const expectedByIndex = new Map(
    chunks.map((chunk, index) => [
      index,
      {
        contentHash: hashText(chunk),
        embeddingModel: config.embedding.model,
        embeddingDimensions: expectedDimensions,
      },
    ])
  );

  return rows.some((row) => {
    const expected = expectedByIndex.get(row.chunkIndex);
    return (
      !expected ||
      row.contentHash !== expected.contentHash ||
      row.embeddingModel !== expected.embeddingModel ||
      row.embeddingDimensions !== expected.embeddingDimensions
    );
  });
}

export async function getPgvectorStatus(): Promise<{
  available: boolean;
  installed: boolean;
  version: string | null;
  indexName: string | null;
  dimensions: number;
}> {
  try {
    const config = await getStoredAiConfig();
    const dimensions = normalizeEmbeddingDimensions(config.embedding.dimensions);
    const rows = (await db.execute(sql`
      SELECT
        EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') AS "available",
        EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS "installed",
        (SELECT extversion FROM pg_extension WHERE extname = 'vector') AS "version",
        EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = ${vectorIndexName(dimensions)}
        ) AS "hasIndex"
    `)) as any[];
    const row = rows[0] || {};

    return {
      available: Boolean(row.available),
      installed: Boolean(row.installed),
      version: row.version || null,
      indexName: row.hasIndex ? vectorIndexName(dimensions) : null,
      dimensions,
    };
  } catch (error: any) {
    throw new DatabaseError('Failed to check pgvector status', error);
  }
}

export async function ensurePgvectorReady(): Promise<
  Awaited<ReturnType<typeof getPgvectorStatus>>
> {
  try {
    const before = await getPgvectorStatus();
    if (!before.available) {
      throw new Error('pgvector extension is not available in this Postgres image');
    }

    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
    const dimensions = before.dimensions;
    const indexName = vectorIndexName(dimensions);
    await db.execute(
      sql.raw(`
      CREATE INDEX IF NOT EXISTS "${indexName}"
      ON "document_embeddings"
      USING hnsw (("embedding"::vector(${dimensions})) vector_cosine_ops)
      WHERE "embeddingDimensions" = ${dimensions}
    `)
    );

    return getPgvectorStatus();
  } catch (error: any) {
    throw new DatabaseError('Failed to enable pgvector', error);
  }
}

export async function enqueueEmbeddingJob(
  sourceType: AiSourceType,
  sourceId: string,
  ownerId: string,
  action: EmbeddingJobAction = 'upsert',
  force = false
): Promise<void> {
  try {
    if (!VALID_SOURCE_TYPES.has(sourceType)) return;

    if (action !== 'delete' && !(await isAiEligibleUser(ownerId))) {
      await deleteEmbeddingsForSource(sourceType, sourceId);
      return;
    }

    if (!force && action !== 'delete' && !shouldAutoIndex()) {
      return;
    }

    const [existing] = await db
      .select({ id: embeddingJobs.id })
      .from(embeddingJobs)
      .where(
        and(
          eq(embeddingJobs.sourceType, sourceType),
          eq(embeddingJobs.sourceId, sourceId),
          eq(embeddingJobs.status, 'pending')
        )
      )
      .limit(1);

    if (existing) return;

    await db.insert(embeddingJobs).values({
      ownerId,
      sourceType,
      sourceId,
      action,
      status: 'pending',
      attempts: 0,
      createdAt: sql`now()`,
      updatedAt: sql`now()`,
    });
  } catch (error: any) {
    throw new DatabaseError('Failed to enqueue embedding job', error);
  }
}

export async function deleteEmbeddingsForSource(
  sourceType: AiSourceType,
  sourceId: string
): Promise<void> {
  try {
    await db
      .delete(documentEmbeddings)
      .where(
        and(
          eq(documentEmbeddings.sourceType, sourceType),
          eq(documentEmbeddings.sourceId, sourceId)
        )
      );
  } catch (error: any) {
    throw new DatabaseError('Failed to delete document embeddings', error);
  }
}

export async function deleteEmbeddingsForOwner(ownerId: string): Promise<void> {
  try {
    await db.delete(documentEmbeddings).where(eq(documentEmbeddings.ownerId, ownerId));
    await db.delete(embeddingJobs).where(eq(embeddingJobs.ownerId, ownerId));
  } catch (error: any) {
    throw new DatabaseError('Failed to delete user document embeddings', error);
  }
}

export async function enqueueBackfillEmbeddingJobs(): Promise<{ queued: number }> {
  try {
    const config = await getStoredAiConfig();
    if (!isVectorUsable(config)) {
      throw new Error('AI vector storage is disabled');
    }

    let queued = 0;
    const roteRows = await db
      .select({ id: rotes.id, ownerId: rotes.authorid })
      .from(rotes)
      .innerJoin(users, eq(rotes.authorid, users.id))
      .where(eq(users.emailVerified, true));
    const articleRows = await db
      .select({ id: articles.id, ownerId: articles.authorId })
      .from(articles)
      .innerJoin(users, eq(articles.authorId, users.id))
      .where(eq(users.emailVerified, true));

    for (const row of roteRows) {
      const source = await getSourceDocument('rote', row.id);
      if (source && (await sourceNeedsEmbeddingBackfill('rote', source, config))) {
        await enqueueEmbeddingJob('rote', row.id, row.ownerId, 'upsert', true);
        queued += 1;
      }
    }
    for (const row of articleRows) {
      const source = await getSourceDocument('article', row.id);
      if (source && (await sourceNeedsEmbeddingBackfill('article', source, config))) {
        await enqueueEmbeddingJob('article', row.id, row.ownerId, 'upsert', true);
        queued += 1;
      }
    }

    return { queued };
  } catch (error: any) {
    throw new DatabaseError('Failed to enqueue backfill embedding jobs', error);
  }
}

export async function getEmbeddingJobStats(): Promise<Record<EmbeddingJobStatus, number>> {
  const rows = (await db.execute(sql`
    SELECT status, COUNT(*)::int AS count
    FROM "embedding_jobs"
    GROUP BY status
  `)) as any[];

  const stats: Record<EmbeddingJobStatus, number> = {
    pending: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
  };
  rows.forEach((row) => {
    if (row.status in stats) {
      stats[row.status as EmbeddingJobStatus] = Number(row.count) || 0;
    }
  });
  return stats;
}

async function markJob(
  jobId: string,
  status: EmbeddingJobStatus,
  data?: { error?: string | null; attempts?: number }
): Promise<void> {
  await db
    .update(embeddingJobs)
    .set({
      status,
      error: data?.error ?? null,
      attempts: data?.attempts,
      lockedAt: status === 'running' ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(embeddingJobs.id, jobId));
}

async function processJob(job: EmbeddingJob, config: AiConfig): Promise<void> {
  if (job.action === 'delete') {
    await deleteEmbeddingsForSource(job.sourceType as AiSourceType, job.sourceId);
    return;
  }

  const sourceType = job.sourceType as AiSourceType;
  const source = await getSourceDocument(sourceType, job.sourceId);
  if (!source) {
    await deleteEmbeddingsForSource(sourceType, job.sourceId);
    return;
  }

  const ownerId = getSourceOwner(sourceType, source);
  if (!(await isAiEligibleUser(ownerId))) {
    await deleteEmbeddingsForSource(sourceType, job.sourceId);
    return;
  }

  const document = buildSourceDocument(sourceType, source);
  const chunks = splitIntoChunks(
    document.text,
    config.indexing.chunkSize,
    config.indexing.chunkOverlap
  );

  await deleteEmbeddingsForSource(sourceType, job.sourceId);
  if (chunks.length === 0) return;

  const expectedDimensions = normalizeEmbeddingDimensions(config.embedding.dimensions);
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const { embedding, usage } = await createEmbedding(config.embedding, chunk);

    if (usage) {
      // Background log
      logAiTokenUsage({
        userid: ownerId,
        model: config.embedding.model,
        type: 'embedding',
        promptTokens: usage.prompt_tokens,
        completionTokens: 0,
        totalTokens: usage.total_tokens,
      });
    }
    if (embedding.length !== expectedDimensions) {
      throw new Error(
        `Embedding dimensions mismatch: expected ${expectedDimensions}, got ${embedding.length}`
      );
    }

    await db.insert(documentEmbeddings).values({
      ownerId,
      sourceType,
      sourceId: job.sourceId,
      chunkIndex: index,
      contentHash: hashText(chunk),
      embeddingModel: config.embedding.model,
      embeddingDimensions: expectedDimensions,
      embedding: vectorToLiteral(embedding),
      text: chunk,
      metadata: document.metadata,
      createdAt: sql`now()`,
      updatedAt: sql`now()`,
    });
  }
}

export async function processPendingEmbeddingJobs(limit?: number): Promise<{
  processed: number;
  failed: number;
  skipped: boolean;
}> {
  const config = await getStoredAiConfig();
  if (!isVectorUsable(config) || config.indexing.paused) {
    return { processed: 0, failed: 0, skipped: true };
  }

  const batchSize = Math.min(Math.max(limit || config.indexing.batchSize || 1, 1), 20);
  const jobs = await db.query.embeddingJobs.findMany({
    where: (tbl, { eq }) => eq(tbl.status, 'pending'),
    orderBy: (tbl) => [asc(tbl.createdAt)],
    limit: batchSize,
  });

  let processed = 0;
  let failed = 0;

  for (const job of jobs) {
    const attempts = (job.attempts || 0) + 1;
    await markJob(job.id, 'running', { attempts });
    try {
      await processJob(job, config);
      await markJob(job.id, 'succeeded', { attempts });
      processed += 1;
    } catch (error: any) {
      const nextStatus: EmbeddingJobStatus =
        attempts >= (config.indexing.maxRetries || DEFAULT_AI_CONFIG.indexing.maxRetries)
          ? 'failed'
          : 'pending';
      await markJob(job.id, nextStatus, {
        attempts,
        error: error?.message || 'Unknown embedding error',
      });
      failed += 1;
    }
  }

  return { processed, failed, skipped: false };
}

export async function retryFailedEmbeddingJobs(): Promise<{ retried: number }> {
  const rows = await db
    .update(embeddingJobs)
    .set({ status: 'pending', error: null, lockedAt: null, updatedAt: new Date() })
    .where(eq(embeddingJobs.status, 'failed'))
    .returning({ id: embeddingJobs.id });
  return { retried: rows.length };
}

export async function clearAllEmbeddings(): Promise<void> {
  await db.delete(documentEmbeddings);
  await db.delete(embeddingJobs);
}

export async function setIndexingPaused(paused: boolean): Promise<AiConfig> {
  const current = await getStoredAiConfig();
  const next = mergeAiConfig({
    ...current,
    indexing: {
      ...current.indexing,
      paused,
    },
  });
  await updateStoredAiConfig(next);
  return next;
}

export async function semanticSearch(params: {
  query: string;
  ownerId?: string;
  scope?: 'mine' | 'public';
  sourceTypes?: AiSourceType[];
  timeRange?: AiNormalizedTimeRange | null;
  tags?: { include?: string[]; exclude?: string[]; match?: 'any' | 'all' };
  semanticScope?: string[];
  state?: 'private' | 'public' | 'all';
  archived?: boolean | null;
  limit?: number;
  exclude?: { sourceType: AiSourceType; sourceId: string };
  excludeIds?: string[];
}): Promise<SemanticSearchResult[]> {
  const config = await getStoredAiConfig();
  if (!isVectorUsable(config)) {
    throw new Error('AI vector search is disabled');
  }
  if (params.scope === 'public' && !config.publicExploreVectorEnabled) {
    throw new Error('Public semantic search is disabled');
  }

  const dimensions = normalizeEmbeddingDimensions(config.embedding.dimensions);
  const limit = normalizeLimit(params.limit);
  const queryText = [params.query, ...(params.semanticScope || [])].filter(Boolean).join('\n');

  let queryEmbedding: number[];
  let usage: { prompt_tokens: number; total_tokens: number } | undefined;
  if (queryText) {
    const result = await createEmbedding(config.embedding, queryText);
    queryEmbedding = result.embedding;
    usage = result.usage;
  } else {
    // Empty query (tag/time filter only) — embed a generic text so pgvector
    // returns all matching results in insertion order (similarity will be low
    // but not NaN, so the WHERE/HAVING clause still works).
    const result = await createEmbedding(config.embedding, 'all notes');
    queryEmbedding = result.embedding;
    usage = result.usage;
  }
  if (usage && params.ownerId) {
    logAiTokenUsage({
      userid: params.ownerId,
      model: config.embedding.model,
      type: 'embedding',
      promptTokens: usage.prompt_tokens,
      completionTokens: 0,
      totalTokens: usage.total_tokens,
    });
  }
  if (queryEmbedding.length !== dimensions) {
    throw new Error(
      `Embedding dimensions mismatch: expected ${dimensions}, got ${queryEmbedding.length}`
    );
  }

  const securityConfig = getGlobalConfig<SecurityConfig>('security');
  const requireVerifiedEmailForExplore = securityConfig?.requireVerifiedEmailForExplore === true;
  const sourceTypes = Array.from(
    new Set(
      (params.sourceTypes || ['rote', 'article']).filter((type) => VALID_SOURCE_TYPES.has(type))
    )
  );
  const vectorLiteral = vectorToLiteral(queryEmbedding);
  const sourceTypeSql =
    sourceTypes.length === 1
      ? sql`AND de."sourceType" = ${sourceTypes[0]}`
      : sourceTypes.length === 2
        ? sql``
        : sql`AND false`;
  const excludeSql = params.exclude
    ? sql`AND NOT (de."sourceType" = ${params.exclude.sourceType} AND de."sourceId" = ${params.exclude.sourceId})`
    : sql``;
  const excludeIdsSql =
    params.excludeIds && params.excludeIds.length > 0
      ? sql`AND NOT ((de."sourceType" || ':' || de."sourceId") = ANY(ARRAY[${sql.join(
          params.excludeIds.map((id) => sql`${id}`),
          sql`, `
        )}]::text[]))`
      : sql``;
  const tags = {
    include: params.tags?.include?.filter(Boolean) || [],
    exclude: params.tags?.exclude?.filter(Boolean) || [],
    match: params.tags?.match === 'all' ? 'all' : 'any',
  };
  const hasTagFilter = tags.include.length > 0 || tags.exclude.length > 0;
  const includeTagsSql =
    tags.include.length > 0
      ? tags.match === 'all'
        ? sql`AND r."tags" @> ${buildTextArraySql(tags.include)}`
        : sql`AND r."tags" && ${buildTextArraySql(tags.include)}`
      : sql``;
  const excludeTagsSql =
    tags.exclude.length > 0 ? sql`AND NOT (r."tags" && ${buildTextArraySql(tags.exclude)})` : sql``;
  const tagFilterSql = hasTagFilter
    ? sql`
      AND de."sourceType" = 'rote'
      AND r."id" IS NOT NULL
      ${includeTagsSql}
      ${excludeTagsSql}
    `
    : sql``;
  const stateSql =
    params.state && params.state !== 'all'
      ? sql`AND de."sourceType" = 'rote' AND r."state" = ${params.state}`
      : sql``;
  const archivedSql =
    typeof params.archived === 'boolean'
      ? sql`AND de."sourceType" = 'rote' AND r."archived" = ${params.archived}`
      : sql``;
  const timeRangeSql = params.timeRange
    ? sql`
      AND (
        (de."sourceType" = 'rote' AND r."createdAt" >= ${params.timeRange.from}::timestamptz AND r."createdAt" <= ${params.timeRange.to}::timestamptz)
        OR
        (de."sourceType" = 'article' AND a."createdAt" >= ${params.timeRange.from}::timestamptz AND a."createdAt" <= ${params.timeRange.to}::timestamptz)
      )
    `
    : sql``;
  const liveSourceSql = sql`
    AND (
      (de."sourceType" = 'rote' AND r."id" IS NOT NULL)
      OR
      (de."sourceType" = 'article' AND a."id" IS NOT NULL)
    )
  `;
  const permissionSql =
    params.scope === 'public'
      ? sql`
        AND de."sourceType" = 'rote'
        AND r."authorid" = de."ownerId"
        AND r."state" = 'public'
        AND r."archived" = false
        AND NOT EXISTS (
          SELECT 1 FROM "user_settings" us
          WHERE us."userid" = r."authorid" AND us."allowExplore" = false
        )
        ${
          requireVerifiedEmailForExplore
            ? sql`AND EXISTS (
                SELECT 1 FROM "users" u
                WHERE u."id" = r."authorid" AND u."emailVerified" = true
              )`
            : sql``
        }
      `
      : sql`
        AND de."ownerId" = ${params.ownerId}
        AND (
          (de."sourceType" = 'rote' AND r."authorid" = ${params.ownerId})
          OR
          (de."sourceType" = 'article' AND a."authorId" = ${params.ownerId})
        )
      `;

  const rows = (await db.execute(sql`
    SELECT
      de."id",
      de."ownerId",
      de."sourceType",
      de."sourceId",
      de."chunkIndex",
      de."text",
      CASE
        WHEN de."sourceType" = 'rote' THEN jsonb_build_object(
          'title', COALESCE(r."title", ''),
          'tags', COALESCE(r."tags", ARRAY[]::text[]),
          'state', r."state",
          'archived', r."archived",
          'createdAt', r."createdAt",
          'updatedAt', r."updatedAt"
        )
        ELSE jsonb_build_object(
          'createdAt', a."createdAt",
          'updatedAt', a."updatedAt"
        )
      END AS "metadata",
      1 - ((de."embedding"::vector(${sql.raw(String(dimensions))})) <=> (${vectorLiteral}::vector(${sql.raw(
        String(dimensions)
      )}))) AS "similarity"
    FROM "document_embeddings" de
    LEFT JOIN "rotes" r ON de."sourceType" = 'rote' AND r."id" = de."sourceId"
    LEFT JOIN "articles" a ON de."sourceType" = 'article' AND a."id" = de."sourceId"
    WHERE de."embeddingModel" = ${config.embedding.model}
      AND de."embeddingDimensions" = ${dimensions}
      ${liveSourceSql}
      ${permissionSql}
      ${sourceTypeSql}
      ${excludeSql}
      ${excludeIdsSql}
      ${tagFilterSql}
      ${stateSql}
      ${archivedSql}
      ${timeRangeSql}
    ORDER BY (de."embedding"::vector(${sql.raw(String(dimensions))})) <=> (${vectorLiteral}::vector(${sql.raw(
      String(dimensions)
    )}))
    LIMIT ${limit * 3}
  `)) as any[];

  const bestBySource = new Map<string, SemanticSearchResult>();
  for (const row of rows) {
    const key = `${row.sourceType}:${row.sourceId}`;
    const result: SemanticSearchResult = {
      id: row.id,
      ownerId: row.ownerId,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      chunkIndex: Number(row.chunkIndex),
      text: row.text,
      similarity: Number(row.similarity),
      metadata: row.metadata || {},
    };
    const existing = bestBySource.get(key);
    if (!existing || result.similarity > existing.similarity) {
      bestBySource.set(key, result);
    }
  }

  return Array.from(bestBySource.values())
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

export async function buildRetrievalContext(params: {
  ownerId: string;
  plan: AiRetrievalPlan;
  limit: number;
  excludeIds?: string[];
}): Promise<{
  sources: SemanticSearchResult[];
  context: string;
  diagnostics: RetrievalContextDiagnostics;
}> {
  const { plan } = params;
  const safeExcludeIds = sanitizeExcludeIds(params.excludeIds);
  const minUsefulSourceCount = getMinUsefulSourceCount(plan);
  const maxSnippetLength = isDeepAnalysisPlan(plan) ? 700 : DEFAULT_EVIDENCE_SNIPPET_LENGTH;
  const hasComparisonGroups = Boolean(plan.comparison?.groups.length);

  const baseSearch = async (filters: AiRetrievalFilters, limit: number) =>
    semanticSearch({
      query: plan.query,
      ownerId: params.ownerId,
      limit,
      sourceTypes: filters.sourceTypes,
      timeRange: filters.time?.normalizedRange || null,
      tags: filters.tags,
      semanticScope: filters.semanticScope,
      state: filters.state,
      archived: filters.archived,
      excludeIds: safeExcludeIds,
    });

  const groupedResults: Array<{ label: string; sources: SemanticSearchResult[] }> = [];
  if (plan.comparison?.groups.length) {
    for (const group of plan.comparison.groups) {
      groupedResults.push({
        label: group.label,
        sources: await baseSearch(group.filters, Math.max(4, Math.ceil(params.limit / 2))),
      });
    }
  } else {
    groupedResults.push({
      label: 'Context',
      sources: await baseSearch(plan.filters, params.limit),
    });
  }

  const sourceByKey = new Map<string, SemanticSearchResult>();
  groupedResults.forEach((group) => {
    group.sources.forEach((source) => {
      const key = `${source.sourceType}:${source.sourceId}`;
      const existing = sourceByKey.get(key);
      if (!existing || source.similarity > existing.similarity) {
        sourceByKey.set(key, source);
      }
    });
  });
  const sources = Array.from(sourceByKey.values())
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, params.limit);

  const contextSources: SemanticSearchResult[] = [];
  const contextBlocks: string[] = [];
  let remainingBudget = DEFAULT_EVIDENCE_CONTEXT_BUDGET;
  const groupLabelsBySourceKey = new Map<string, Set<string>>();
  groupedResults.forEach((group) => {
    group.sources.forEach((source) => {
      const key = `${source.sourceType}:${source.sourceId}`;
      const labels = groupLabelsBySourceKey.get(key) || new Set<string>();
      labels.add(group.label);
      groupLabelsBySourceKey.set(key, labels);
    });
  });

  for (const source of sources.slice(0, MAX_EVIDENCE_SOURCE_COUNT)) {
    const index = contextSources.length + 1;
    const key = `${source.sourceType}:${source.sourceId}`;
    const groupLabels = hasComparisonGroups
      ? Array.from(groupLabelsBySourceKey.get(key) || [])
      : [];
    let block = buildEvidenceBlock(source, index, maxSnippetLength, groupLabels);
    if (block.length > remainingBudget) {
      if (contextSources.length > 0) break;
      block = buildEvidenceBlock(source, index, Math.max(300, remainingBudget - 240), groupLabels);
      if (block.length > remainingBudget) {
        block = block.slice(0, Math.max(0, remainingBudget - 20)).trim();
      }
    }

    if (!block) break;
    contextSources.push(source);
    contextBlocks.push(block);
    remainingBudget -= block.length + 2;
  }

  const contextSourceKeys = new Set(
    contextSources.map((source) => `${source.sourceType}:${source.sourceId}`)
  );
  const groupStats = groupedResults.map((group) => {
    const groupKeys = new Set(
      group.sources.map((source) => `${source.sourceType}:${source.sourceId}`)
    );
    const groupMinUsefulCount = plan.comparison?.groups.length
      ? MIN_COMPARISON_GROUP_SAMPLE_SIZE
      : minUsefulSourceCount;
    return {
      label: group.label,
      candidateCount: groupKeys.size,
      contextSourceCount: Array.from(groupKeys).filter((key) => contextSourceKeys.has(key)).length,
      sampleStatus: classifySampleStatus(groupKeys.size, groupMinUsefulCount),
    };
  });
  let sampleStatus = classifySampleStatus(sources.length, minUsefulSourceCount);
  if (groupStats.length > 1) {
    if (groupStats.every((group) => group.sampleStatus === 'no_evidence')) {
      sampleStatus = 'no_evidence';
    } else if (groupStats.some((group) => group.sampleStatus !== 'adequate')) {
      sampleStatus = 'limited_sample';
    }
  }
  const diagnostics: RetrievalContextDiagnostics = {
    candidateCount: sources.length,
    contextSourceCount: contextSources.length,
    omittedSourceCount: Math.max(sources.length - contextSources.length, 0),
    minUsefulSourceCount,
    sampleStatus,
    groupStats,
  };
  const groupSummary = groupStats
    .map(
      (group) =>
        `- ${group.label}: ${group.contextSourceCount}/${group.candidateCount} sources in context (${group.sampleStatus})`
    )
    .join('\n');
  const evidenceSummary = `Evidence summary:
- Candidate sources found: ${diagnostics.candidateCount}
- Sources included in answer context: ${diagnostics.contextSourceCount}
- Omitted because of context budget: ${diagnostics.omittedSourceCount}
- Minimum useful sources for this operation: ${diagnostics.minUsefulSourceCount}
- Sample status: ${diagnostics.sampleStatus}
${groupSummary ? `\nGroup coverage:\n${groupSummary}` : ''}`;
  const context = `${evidenceSummary}\n\nEvidence:\n${
    contextBlocks.length ? contextBlocks.join('\n\n') : '(no matching evidence found)'
  }`;

  return { sources: contextSources, context, diagnostics };
}

export async function chatWithRoteContext(params: {
  ownerId: string;
  message: string;
  limit?: number;
  pendingPlan?: AiRetrievalPlan | null;
  clarificationAnswer?: string;
  previousPlan?: AiRetrievalPlan | null;
  excludeIds?: string[];
  history?: { role: 'user' | 'assistant'; content: string }[];
}): Promise<{
  answer: string;
  sources: SemanticSearchResult[];
  plan?: AiRetrievalPlan;
  clarification?: { question: string; pendingPlan: AiRetrievalPlan };
}> {
  const { config, messages, sources, plan, clarification } = await prepareRoteChatContext(params);
  if (!messages.length) {
    const question =
      clarification?.question || plan.clarificationQuestion || 'Can you clarify the scope?';
    return {
      answer: question,
      sources: [],
      plan,
      clarification: { question, pendingPlan: plan },
    };
  }

  const { content, usage } = await createChatCompletion(config.chat, messages);
  if (usage) {
    await logChatTokenUsage(params.ownerId, config.chat.model, usage);
  }
  const answer = stripLegacyNeedsMoreTag(content).trim() || fallbackAnswer(sources);

  return { answer, sources, plan };
}

export function sanitizePreviousPlan(plan: any, availableTags: string[]): AiRetrievalPlan | null {
  if (!plan || typeof plan !== 'object') return null;
  const tagSet = new Set(availableTags);
  const defaults = createDefaultFilters();
  const rawFilters = plan.filters && typeof plan.filters === 'object' ? plan.filters : {};
  return {
    originalMessage: String(plan.originalMessage || ''),
    operations: Array.isArray(plan.operations) ? plan.operations : ['summarize'],
    query: String(plan.query || ''),
    filters: {
      time:
        rawFilters.time && typeof rawFilters.time === 'object' ? rawFilters.time : defaults.time,
      tags: {
        include: Array.isArray(rawFilters.tags?.include)
          ? rawFilters.tags.include.filter((t: string) => tagSet.has(t))
          : [],
        exclude: Array.isArray(rawFilters.tags?.exclude)
          ? rawFilters.tags.exclude.filter((t: string) => tagSet.has(t))
          : [],
        match: rawFilters.tags?.match === 'all' ? 'all' : 'any',
        unresolved: [],
        confidence: 1,
      },
      semanticScope: Array.isArray(rawFilters.semanticScope)
        ? rawFilters.semanticScope.filter((s: unknown) => typeof s === 'string').slice(0, 20)
        : [],
      sourceTypes: Array.isArray(rawFilters.sourceTypes)
        ? rawFilters.sourceTypes.filter((t: string) => t === 'rote' || t === 'article')
        : ['rote', 'article'],
      state:
        rawFilters.state === 'private' || rawFilters.state === 'public' ? rawFilters.state : 'all',
      archived: typeof rawFilters.archived === 'boolean' ? rawFilters.archived : null,
    },
    comparison: null,
    confidence: typeof plan.confidence === 'number' ? plan.confidence : 0.5,
    needsClarification: false,
    clarificationQuestion: null,
    retrievalNeeded: plan.retrievalNeeded !== false,
    pagination: plan.pagination === 'more' ? 'more' : null,
    summary: Array.isArray(plan.summary) ? plan.summary : [],
  };
}

export function sanitizeExcludeIds(ids: string[] | undefined): string[] | undefined {
  if (!ids?.length) return undefined;
  const sanitized = ids.filter((id) => /^(rote|article):[a-zA-Z0-9_-]+$/.test(id)).slice(0, 500);
  return sanitized.length > 0 ? sanitized : undefined;
}

export async function prepareRoteChatContext(params: {
  ownerId: string;
  message: string;
  limit?: number;
  pendingPlan?: AiRetrievalPlan | null;
  clarificationAnswer?: string;
  previousPlan?: AiRetrievalPlan | null;
  excludeIds?: string[];
  history?: { role: 'user' | 'assistant'; content: string }[];
  onPlanGenerated?: (plan: AiRetrievalPlan) => Promise<void> | void;
  onPlanThinkingDelta?: (text: string) => Promise<void> | void;
}): Promise<{
  config: AiConfig;
  messages: ChatMessage[];
  sources: SemanticSearchResult[];
  plan: AiRetrievalPlan;
  clarification?: { question: string; pendingPlan: AiRetrievalPlan };
}> {
  const config = await getStoredAiConfig();
  if (!config.enabled) {
    throw new Error('AI is disabled');
  }

  const availableTags = await getUserRoteTags(params.ownerId);
  const safePreviousPlan = sanitizePreviousPlan(params.previousPlan, availableTags);

  const plan = await createRetrievalPlan({
    ownerId: params.ownerId,
    message: params.message,
    config,
    pendingPlan: params.pendingPlan,
    clarificationAnswer: params.clarificationAnswer,
    previousPlan: safePreviousPlan,
    history: params.history,
    onThinkingDelta: params.onPlanThinkingDelta,
    onUsage: (usage) => logChatTokenUsage(params.ownerId, config.chat.model, usage),
  });

  if (params.onPlanGenerated) {
    await params.onPlanGenerated(plan);
  }

  if (plan.needsClarification) {
    const question = plan.clarificationQuestion || 'Can you clarify the scope?';
    return {
      config,
      messages: [],
      sources: [],
      plan,
      clarification: { question, pendingPlan: plan },
    };
  }

  // No-retrieval path: pure chat without note context
  if (!plan.retrievalNeeded) {
    const chatMessages: ChatMessage[] = [
      {
        role: 'system',
        content: 'You are a helpful assistant. Answer naturally based on the conversation context.',
      },
    ];
    if (params.history && params.history.length > 0) {
      chatMessages.push(
        ...params.history.map((m) => ({
          role: (m.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
          content: m.content,
        }))
      );
    }
    chatMessages.push({ role: 'user', content: params.message });
    return { config, messages: chatMessages, sources: [], plan };
  }

  const limit = resolveRetrievalLimit(plan, params.limit);

  const { sources, context } = await buildRetrievalContext({
    ownerId: params.ownerId,
    plan,
    limit,
    excludeIds: params.excludeIds,
  });

  const scopeSummary = plan.summary?.length ? plan.summary.join('；') : '默认范围';
  const operations = plan.operations.join(', ');

  const prompt = `Retrieval scope: ${scopeSummary}\nOperations: ${operations}\n\nContext:\n${
    context || '(no relevant context found)'
  }\n\nQuestion:\n${plan.originalMessage || params.message}`;

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `You answer questions using the user provided Rote notes and articles. Cite source numbers when useful. Respect the retrieval scope and mention when the answer is limited by that scope.

Evidence policy:
- Never request another retrieval pass and never output internal protocol markers.
- If the evidence summary says "no_evidence", say that no matching records were found and avoid inventing.
- If the evidence summary says "limited_sample", still answer when useful, but clearly label the answer as tentative and explain that the sample is small.
- For personality, MBTI, mood, stress, or pattern analysis, prefer signals and hypotheses over firm conclusions unless the evidence summary says the sample is adequate.
- If sources were omitted because of context budget, answer from the included evidence and mention that the view is limited when relevant.
- For TODO, Flag, task, or open-loop analysis, treat archived Rote notes as closed/completed. Do not list archived notes as unfinished work.

Answer in the user's language.`,
    },
  ];

  if (params.history && params.history.length > 0) {
    messages.push(
      ...params.history.map((m) => ({
        role: (m.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
        content: m.content,
      }))
    );
  }

  messages.push({ role: 'user', content: prompt });

  return { config, messages, sources, plan };
}
