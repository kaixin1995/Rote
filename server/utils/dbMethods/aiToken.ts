import { aiTokenUsageLogs } from '../../drizzle/schema';
import db from '../drizzle';

export async function logAiTokenUsage(params: {
  userid: string;
  model: string;
  type: 'chat' | 'embedding';
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}) {
  try {
    if (params.totalTokens === 0) return;
    await db.insert(aiTokenUsageLogs).values(params);
  } catch (error) {
    console.error('Failed to log AI token usage:', error);
  }
}
