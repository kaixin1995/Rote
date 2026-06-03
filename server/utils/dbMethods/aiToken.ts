import { aiTokenUsageLogs } from '../../drizzle/schema';
import db from '../drizzle';

function normalizeTokenCount(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
}

export async function logAiTokenUsage(params: {
  userid: string;
  model: string;
  type: 'chat' | 'embedding';
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}) {
  try {
    const promptTokens = normalizeTokenCount(params.promptTokens);
    const completionTokens = normalizeTokenCount(params.completionTokens);
    const totalTokens = normalizeTokenCount(params.totalTokens) || promptTokens + completionTokens;

    if (totalTokens === 0) return;

    await db.insert(aiTokenUsageLogs).values({
      ...params,
      promptTokens,
      completionTokens,
      totalTokens,
    });
  } catch (error) {
    console.error('Failed to log AI token usage:', error);
  }
}
