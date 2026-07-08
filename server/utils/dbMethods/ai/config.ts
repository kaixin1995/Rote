import { count, eq, sql } from 'drizzle-orm';
import { rotes } from '../../../drizzle/schema';
import { hasCapability } from '../../../authz/capabilityService';
import type { AiConfig } from '../../../types/config';
import { DEFAULT_AI_CONFIG, mergeAiConfig } from '../../ai/providers';
import { getConfig, getGlobalConfig, setConfig } from '../../config';
import db from '../../drizzle';
import { DatabaseError } from '../common';

export function getRuntimeAiConfig(): AiConfig {
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

export function isVectorUsable(config = getRuntimeAiConfig()): boolean {
  return config.enabled === true && config.vectorEnabled === true;
}

export function shouldAutoIndex(config = getRuntimeAiConfig()): boolean {
  return isVectorUsable(config) && config.autoIndexEnabled === true;
}

export async function isAiEligibleUser(userId: string): Promise<boolean> {
  return hasCapability(userId, 'ai.chat');
}

export async function getOwnerAiMemoryStats(ownerId: string): Promise<{
  roteCount: number;
  indexedRoteCount: number;
}> {
  try {
    const [[roteCountResult], indexedRoteRows] = await Promise.all([
      db.select({ count: count() }).from(rotes).where(eq(rotes.authorid, ownerId)),
      db.execute(sql`
        SELECT COUNT(DISTINCT de."sourceId")::int AS count
        FROM "document_embeddings" de
        INNER JOIN "rotes" r ON r."id" = de."sourceId"
        WHERE de."ownerId" = ${ownerId}
          AND de."sourceType" = 'rote'
          AND r."authorid" = ${ownerId}
      `) as Promise<Array<{ count: number }>>,
    ]);

    return {
      roteCount: Number(roteCountResult?.count) || 0,
      indexedRoteCount: Number(indexedRoteRows[0]?.count) || 0,
    };
  } catch (error: any) {
    throw new DatabaseError('Failed to get AI memory stats', error);
  }
}
