import { sql } from 'drizzle-orm';
import db from '../../drizzle';
import { DatabaseError } from '../common';
import { getStoredAiConfig } from './config';
import { normalizeEmbeddingDimensions, vectorIndexName } from './documents';

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
