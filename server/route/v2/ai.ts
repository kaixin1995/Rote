import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { User } from '../../drizzle/schema';
import { authenticateJWT, requireAdmin } from '../../middleware/jwtAuth';
import type { HonoContext, HonoVariables } from '../../types/hono';
import {
  createChatCompletionStreamParts,
  testChatProvider,
  testEmbeddingProvider,
} from '../../utils/ai/client';
import { AI_PROVIDER_PRESETS, resolveIncomingAiConfig } from '../../utils/ai/providers';
import {
  type AiSourceType,
  chatWithRoteContext,
  clearAllEmbeddings,
  enqueueBackfillEmbeddingJobs,
  ensurePgvectorReady,
  findArticleById,
  findRoteById,
  getEmbeddingJobStats,
  getPgvectorStatus,
  getStoredAiConfig,
  isAiEligibleUser,
  prepareRoteChatContext,
  processPendingEmbeddingJobs,
  retryFailedEmbeddingJobs,
  semanticSearch,
  setIndexingPaused,
  logAiTokenUsage,
} from '../../utils/dbMethods';
import { bodyTypeCheck, createResponse } from '../../utils/main';

const aiRouter = new Hono<{ Variables: HonoVariables }>();
const VALID_AI_SOURCE_TYPES = new Set<AiSourceType>(['rote', 'article']);
const AI_VERIFICATION_REQUIRED_MESSAGE = 'AI features require a verified account';

async function writeSseEvent(
  stream: Parameters<Parameters<typeof streamSSE>[1]>[0],
  event: string,
  data: unknown
): Promise<void> {
  await stream.writeSSE({
    event,
    data: JSON.stringify(data),
  });
}

aiRouter.get('/providers', authenticateJWT, requireAdmin, (c: HonoContext) =>
  c.json(createResponse(AI_PROVIDER_PRESETS), 200)
);

aiRouter.get('/status', authenticateJWT, async (c: HonoContext) => {
  const user = c.get('user') as User;
  const config = await getStoredAiConfig();
  const vectorStatus = await getPgvectorStatus();
  const eligible = await isAiEligibleUser(user.id);
  return c.json(
    createResponse({
      enabled: config.enabled,
      vectorEnabled: config.vectorEnabled,
      publicExploreVectorEnabled: config.publicExploreVectorEnabled,
      eligible,
      available: eligible && config.enabled && config.vectorEnabled && vectorStatus.installed,
    }),
    200
  );
});

aiRouter.post('/test', authenticateJWT, requireAdmin, bodyTypeCheck, async (c: HonoContext) => {
  const body = await c.req.json();
  const target = body?.target as 'chat' | 'embedding';
  const storedConfig = await getStoredAiConfig();
  const config = body?.config ? resolveIncomingAiConfig(body.config, storedConfig) : storedConfig;

  if (target === 'chat') {
    await testChatProvider(config.chat);
    return c.json(createResponse({ success: true }, 'Chat provider test successful'), 200);
  }

  if (target === 'embedding') {
    const result = await testEmbeddingProvider(config.embedding, config.embedding.dimensions);
    return c.json(
      createResponse(
        { success: true, dimensions: result.dimensions },
        'Embedding provider test successful'
      ),
      200
    );
  }

  return c.json(createResponse(null, 'Invalid test target'), 400);
});

aiRouter.get('/vector/status', authenticateJWT, requireAdmin, async (c: HonoContext) => {
  const status = await getPgvectorStatus();
  return c.json(createResponse(status), 200);
});

aiRouter.post('/vector/enable', authenticateJWT, requireAdmin, async (c: HonoContext) => {
  const status = await ensurePgvectorReady();
  return c.json(createResponse(status, 'pgvector is ready'), 200);
});

aiRouter.get('/index/stats', authenticateJWT, requireAdmin, async (c: HonoContext) => {
  const stats = await getEmbeddingJobStats();
  return c.json(createResponse(stats), 200);
});

aiRouter.post('/index/backfill', authenticateJWT, requireAdmin, async (c: HonoContext) => {
  const result = await enqueueBackfillEmbeddingJobs();
  const stats = await getEmbeddingJobStats();
  return c.json(createResponse({ ...result, stats }, 'Backfill jobs queued'), 200);
});

aiRouter.post('/index/process', authenticateJWT, requireAdmin, async (c: HonoContext) => {
  const result = await processPendingEmbeddingJobs();
  const stats = await getEmbeddingJobStats();
  return c.json(createResponse({ ...result, stats }, 'Embedding jobs processed'), 200);
});

aiRouter.post('/index/retry-failed', authenticateJWT, requireAdmin, async (c: HonoContext) => {
  const result = await retryFailedEmbeddingJobs();
  const stats = await getEmbeddingJobStats();
  return c.json(createResponse({ ...result, stats }, 'Failed jobs requeued'), 200);
});

aiRouter.post('/index/pause', authenticateJWT, requireAdmin, async (c: HonoContext) => {
  const config = await setIndexingPaused(true);
  return c.json(
    createResponse({ paused: config.indexing.paused === true }, 'Indexing paused'),
    200
  );
});

aiRouter.post('/index/resume', authenticateJWT, requireAdmin, async (c: HonoContext) => {
  const config = await setIndexingPaused(false);
  return c.json(
    createResponse({ paused: config.indexing.paused === true }, 'Indexing resumed'),
    200
  );
});

aiRouter.post('/index/clear', authenticateJWT, requireAdmin, async (c: HonoContext) => {
  await clearAllEmbeddings();
  return c.json(createResponse(null, 'Vector index cleared'), 200);
});

aiRouter.post('/search', authenticateJWT, bodyTypeCheck, async (c: HonoContext) => {
  const user = c.get('user') as User;
  if (!(await isAiEligibleUser(user.id))) {
    return c.json(createResponse(null, AI_VERIFICATION_REQUIRED_MESSAGE), 403);
  }

  const body = await c.req.json();
  const query = String(body?.query || '').trim();

  if (!query) {
    return c.json(createResponse(null, 'Query is required'), 400);
  }

  const results = await semanticSearch({
    query,
    ownerId: body?.scope === 'public' ? undefined : user.id,
    scope: body?.scope === 'public' ? 'public' : 'mine',
    sourceTypes: body?.sourceTypes,
    timeRange: body?.timeRange,
    tags: body?.tags,
    semanticScope: body?.semanticScope,
    state: body?.state,
    archived: typeof body?.archived === 'boolean' ? body.archived : null,
    limit: body?.limit,
  });
  return c.json(createResponse(results), 200);
});

aiRouter.post('/related-notes', authenticateJWT, bodyTypeCheck, async (c: HonoContext) => {
  const user = c.get('user') as User;
  if (!(await isAiEligibleUser(user.id))) {
    return c.json(createResponse(null, AI_VERIFICATION_REQUIRED_MESSAGE), 403);
  }

  const body = await c.req.json();
  const sourceType = body?.sourceType as 'rote' | 'article';
  const sourceId = String(body?.sourceId || '');
  let query = '';

  if (sourceType === 'rote') {
    const rote = await findRoteById(sourceId);
    if (!rote || rote.authorid !== user.id) {
      return c.json(createResponse(null, 'Note not found or permission denied'), 404);
    }
    query = `${rote.title || ''}\n${rote.content || ''}`;
  } else if (sourceType === 'article') {
    const article = await findArticleById(sourceId);
    if (!article || article.authorId !== user.id) {
      return c.json(createResponse(null, 'Article not found or permission denied'), 404);
    }
    query = article.content;
  } else {
    return c.json(createResponse(null, 'Invalid source type'), 400);
  }

  const sourceTypes: AiSourceType[] = Array.isArray(body?.sourceTypes)
    ? Array.from(
        new Set<AiSourceType>(
          body.sourceTypes.filter((type: unknown): type is AiSourceType =>
            VALID_AI_SOURCE_TYPES.has(type as AiSourceType)
          )
        )
      )
    : ['rote', 'article'];

  const results = await semanticSearch({
    query,
    ownerId: user.id,
    sourceTypes,
    limit: body?.limit,
    exclude: { sourceType, sourceId },
  });

  return c.json(createResponse(results), 200);
});

aiRouter.post('/chat', authenticateJWT, bodyTypeCheck, async (c: HonoContext) => {
  const user = c.get('user') as User;
  if (!(await isAiEligibleUser(user.id))) {
    return c.json(createResponse(null, AI_VERIFICATION_REQUIRED_MESSAGE), 403);
  }

  const body = await c.req.json();
  const message = String(body?.message || '').trim();

  if (!message) {
    return c.json(createResponse(null, 'Message is required'), 400);
  }

  const result = await chatWithRoteContext({
    ownerId: user.id,
    message,
    limit: body?.limit,
    pendingPlan: body?.pendingPlan,
    clarificationAnswer: body?.clarificationAnswer,
  });
  return c.json(createResponse(result), 200);
});

aiRouter.post('/chat/stream', authenticateJWT, bodyTypeCheck, async (c: HonoContext) => {
  const user = c.get('user') as User;
  if (!(await isAiEligibleUser(user.id))) {
    return c.json(createResponse(null, AI_VERIFICATION_REQUIRED_MESSAGE), 403);
  }

  const body = await c.req.json();
  const message = String(body?.message || '').trim();

  if (!message) {
    return c.json(createResponse(null, 'Message is required'), 400);
  }

  return streamSSE(c, async (stream) => {
    try {
      await stream.write(': connected\n\n');
      const { config, messages, sources, clarification } = await prepareRoteChatContext({
        ownerId: user.id,
        message,
        limit: body?.limit,
        pendingPlan: body?.pendingPlan,
        clarificationAnswer: body?.clarificationAnswer,
        history: body?.history,
        onPlanThinkingDelta: async (text) => {
          await writeSseEvent(stream, 'thinking', { phase: 'planning', text });
        },
        onPlanGenerated: async (generatedPlan) => {
          await writeSseEvent(stream, 'plan', { plan: generatedPlan });
        },
      });

      if (clarification) {
        await writeSseEvent(stream, 'clarification', clarification);
        await writeSseEvent(stream, 'done', {});
        return;
      }

      await writeSseEvent(stream, 'sources', { sources });

      for await (const part of createChatCompletionStreamParts(config.chat, messages, {
        enableThinking: true,
      })) {
        if (part.type === 'reasoning') {
          await writeSseEvent(stream, 'thinking', { phase: 'answer', text: part.text });
        } else if (part.type === 'usage') {
          logAiTokenUsage({
            userid: user.id,
            model: config.chat.model,
            type: 'chat',
            promptTokens: part.usage.prompt_tokens,
            completionTokens: part.usage.completion_tokens,
            totalTokens: part.usage.total_tokens,
          });
          await writeSseEvent(stream, 'usage', part.usage);
        } else {
          await writeSseEvent(stream, 'delta', { text: part.text });
        }
      }

      await writeSseEvent(stream, 'done', {});
    } catch (error: any) {
      await writeSseEvent(stream, 'error', {
        message: error?.message || 'AI stream failed',
      });
    }
  });
});

export default aiRouter;
