import { asc, eq, sql } from 'drizzle-orm';
import { documentEmbeddings, embeddingJobs, type EmbeddingJob } from '../../../drizzle/schema';
import type { AiConfig } from '../../../types/config';
import { createEmbedding, vectorToLiteral } from '../../ai/client';
import { DEFAULT_AI_CONFIG, mergeAiConfig } from '../../ai/providers';
import db from '../../drizzle';
import { logAiTokenUsage } from '../aiToken';
import {
  getStoredAiConfig,
  isAiEligibleUser,
  isVectorUsable,
  updateStoredAiConfig,
} from './config';
import {
  buildSourceDocument,
  getSourceDocument,
  getSourceOwner,
  hashText,
  normalizeEmbeddingDimensions,
  splitIntoChunks,
} from './documents';
import { deleteEmbeddingsForSource } from './embeddingQueue';
import type { AiSourceType, EmbeddingJobStatus } from './types';

let embeddingJobsProcessing = false;

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
      await logAiTokenUsage({
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
  if (embeddingJobsProcessing) {
    return { processed: 0, failed: 0, skipped: true };
  }
  embeddingJobsProcessing = true;

  try {
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
  } finally {
    embeddingJobsProcessing = false;
  }
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
