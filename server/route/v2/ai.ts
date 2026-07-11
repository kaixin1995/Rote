import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
  AI_MEMORY_UNAVAILABLE_MESSAGE,
  getAiAccessErrorFromAccess,
  getAiMemoryAccessError,
  getUserAiAccess,
  isAiMemoryAvailableForAccess,
} from '../../authz/aiAccess';
import { type User } from '../../drizzle/schema';
import { authenticateJWT } from '../../middleware/jwtAuth';
import type { HonoContext, HonoVariables } from '../../types/hono';
import {
  createChatCompletionStreamParts,
  probeChatProviderToolCalling,
  testChatProvider,
} from '../../utils/ai/client';
import { createDirectSiteChat, streamDirectSiteChat } from '../../utils/ai/directChat';
import { runRoteAgentStream, type RoteAgentStreamEvent } from '../../utils/ai/agent/runtime';
import {
  type AiSourceType,
  chatWithRoteContext,
  findArticleById,
  findRoteById,
  getOwnerAiMemoryStats,
  getPgvectorStatus,
  getStoredAiConfig,
  prepareRoteChatContext,
  searchMemory,
  logAiTokenUsage,
} from '../../utils/dbMethods';
import { bodyTypeCheck, createResponse } from '../../utils/main';
import { registerAdminAiRoutes } from './aiAdmin';
import { registerClientAgentRoutes } from './aiClientAgent';

const aiRouter = new Hono<{ Variables: HonoVariables }>();
const VALID_AI_SOURCE_TYPES = new Set<AiSourceType>(['rote', 'article']);

function getAiMemoryErrorStatus(message: string): 403 | 503 {
  return message === AI_MEMORY_UNAVAILABLE_MESSAGE ? 503 : 403;
}

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

function normalizeSourcePreview(text: unknown): string {
  return String(text || '')
    .replace(/^(Title:[^\n]*\n)?(Tags:[^\n]*\n)?/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function toClientSource(source: any) {
  const metadata = source?.metadata || {};
  const tags = Array.isArray(metadata.tags)
    ? metadata.tags.filter((tag: unknown) => typeof tag === 'string').slice(0, 8)
    : [];

  return {
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    similarity: Number(source.similarity) || 0,
    retrievalMode: source.retrievalMode || metadata.retrievalMode || 'relevance',
    preview: normalizeSourcePreview(source.text),
    metadata: {
      title: typeof metadata.title === 'string' ? metadata.title : '',
      tags,
      state: typeof metadata.state === 'string' ? metadata.state : undefined,
      archived: typeof metadata.archived === 'boolean' ? metadata.archived : undefined,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
      retrievalMode: source.retrievalMode || metadata.retrievalMode || 'relevance',
      retrievalDateField: metadata.retrievalDateField,
    },
  };
}

async function writeAgentSseEvent(
  stream: Parameters<Parameters<typeof streamSSE>[1]>[0],
  event: RoteAgentStreamEvent
): Promise<void> {
  const data = { ...(event as any) };
  delete data.type;
  if (event.type === 'sources') {
    data.sources = Array.isArray(event.sources) ? event.sources.map(toClientSource) : [];
  }
  await writeSseEvent(stream, event.type, data);
}

async function streamToolPlannedChatResponse(
  stream: Parameters<Parameters<typeof streamSSE>[1]>[0],
  user: User,
  body: any,
  message: string
): Promise<void> {
  const { config, messages, sources, clarification } = await prepareRoteChatContext({
    ownerId: user.id,
    message,
    limit: body?.limit,
    excludeIds: body?.excludeIds,
    history: body?.history,
    clientContext: body?.clientContext,
    enableThinking: body?.enableThinking === true,
    onPlanThinkingDelta: async (text) => {
      await writeSseEvent(stream, 'thinking', { phase: 'retrieval_planning', text });
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

  let emittedText = false;
  let lastUsage: any = null;
  for await (const part of createChatCompletionStreamParts(config.chat, messages, {
    enableThinking: body?.enableThinking === true,
  })) {
    if (part.type === 'reasoning') {
      await writeSseEvent(stream, 'thinking', { phase: 'answer', text: part.text });
    } else if (part.type === 'usage') {
      lastUsage = part.usage;
    } else if (part.text) {
      emittedText = true;
      await writeSseEvent(stream, 'delta', { text: part.text });
    }
  }

  if (lastUsage) {
    await logAiTokenUsage({
      userid: user.id,
      model: config.chat.model,
      type: 'chat',
      promptTokens: lastUsage.prompt_tokens,
      completionTokens: lastUsage.completion_tokens,
      totalTokens: lastUsage.total_tokens,
    });
    await writeSseEvent(stream, 'usage', { phase: 'answer', usage: lastUsage });
  }

  if (!emittedText) {
    await writeSseEvent(stream, 'delta', {
      text: sources.length
        ? 'I found related Rote memory, but the model did not return a usable answer. Please try again or narrow the scope.'
        : 'No matching Rote memory was found for this question, so I cannot answer from your notes yet.',
    });
  }

  await writeSseEvent(stream, 'done', {});
}

registerAdminAiRoutes(aiRouter);

aiRouter.get('/status', authenticateJWT, async (c: HonoContext) => {
  const user = c.get('user') as User;
  const config = await getStoredAiConfig();
  const vectorStatus = await getPgvectorStatus();
  const access = await getUserAiAccess(user);
  const eligible = Boolean(
    user.emailVerified || (user as User & { certified?: boolean }).certified
  );
  const memoryStats = await getOwnerAiMemoryStats(user.id);
  const chatBaseUrl = config.chat?.baseUrl || '';
  const isLocalChat =
    /(^https?:\/\/)?(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])(:|\/|$)/i.test(chatBaseUrl) ||
    ['ollama', 'llama-cpp'].includes(config.chat?.providerId || '');
  const chatAvailable =
    config.enabled === true &&
    Boolean(config.chat?.baseUrl?.trim()) &&
    Boolean(config.chat?.model?.trim());
  const memoryAvailable = isAiMemoryAvailableForAccess({ access, config, vectorStatus });
  const available = access.chatAllowed && chatAvailable;
  return c.json(
    createResponse({
      enabled: config.enabled,
      vectorEnabled: config.vectorEnabled,
      publicExploreVectorEnabled: config.publicExploreVectorEnabled,
      eligible,
      chatAllowed: access.chatAllowed,
      chatAvailable,
      chatProviderId: config.chat?.providerId || '',
      chatModel: config.chat?.model || '',
      chatMode: config.enabled ? (isLocalChat ? 'local' : 'site') : 'disabled',
      available,
      memoryAvailable,
      memoryStats,
    }),
    200
  );
});

registerClientAgentRoutes(aiRouter);

aiRouter.post('/site/test', authenticateJWT, async (c: HonoContext) => {
  const user = c.get('user') as User;
  const config = await getStoredAiConfig();
  const vectorStatus = await getPgvectorStatus();
  const access = await getUserAiAccess(user);
  const eligible = Boolean(
    user.emailVerified || (user as User & { certified?: boolean }).certified
  );
  const chatAvailable =
    config.enabled === true &&
    Boolean(config.chat?.baseUrl?.trim()) &&
    Boolean(config.chat?.model?.trim());
  const vectorAvailable = config.vectorEnabled === true && vectorStatus.installed === true;

  const accessError = getAiAccessErrorFromAccess(access);
  if (accessError) {
    return c.json(
      createResponse(
        {
          success: false,
          eligible,
          chatAvailable,
          vectorAvailable,
          model: config.chat?.model || '',
        },
        accessError
      ),
      403
    );
  }

  if (!chatAvailable) {
    return c.json(
      createResponse(
        {
          success: false,
          eligible,
          chatAvailable,
          vectorAvailable,
          model: config.chat?.model || '',
        },
        'Site AI chat model is not configured'
      ),
      400
    );
  }

  const startedAt = Date.now();
  await testChatProvider(config.chat);
  const toolCalling = await probeChatProviderToolCalling(config.chat);
  return c.json(
    createResponse(
      {
        success: true,
        eligible,
        chatAvailable,
        vectorAvailable,
        model: config.chat?.model || '',
        latencyMs: Date.now() - startedAt,
        toolCalling,
      },
      !toolCalling.supported
        ? 'Site chat model works, but tool calling was not detected'
        : vectorAvailable
          ? 'Site AI test successful'
          : 'Site chat model works, but memory vector index is not ready'
    ),
    200
  );
});

aiRouter.post('/search', authenticateJWT, bodyTypeCheck, async (c: HonoContext) => {
  const user = c.get('user') as User;
  const accessError = await getAiMemoryAccessError(user);
  if (accessError) {
    return c.json(createResponse(null, accessError), getAiMemoryErrorStatus(accessError));
  }

  const body = await c.req.json();
  const query = String(body?.query || '').trim();

  if (!query) {
    return c.json(createResponse(null, 'Query is required'), 400);
  }

  const { sources: results } = await searchMemory({
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
  const accessError = await getAiMemoryAccessError(user);
  if (accessError) {
    return c.json(createResponse(null, accessError), getAiMemoryErrorStatus(accessError));
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

  const { sources: results } = await searchMemory({
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
  const access = await getUserAiAccess(user);
  const accessError = getAiAccessErrorFromAccess(access);
  if (accessError) {
    return c.json(createResponse(null, accessError), 403);
  }

  const body = await c.req.json();
  const message = String(body?.message || '').trim();

  if (!message) {
    return c.json(createResponse(null, 'Message is required'), 400);
  }

  const [config, vectorStatus] = await Promise.all([getStoredAiConfig(), getPgvectorStatus()]);
  const memoryAvailable = isAiMemoryAvailableForAccess({ access, config, vectorStatus });
  const result = memoryAvailable
    ? await chatWithRoteContext({
        ownerId: user.id,
        message,
        limit: body?.limit,
        excludeIds: body?.excludeIds,
        history: body?.history,
        clientContext: body?.clientContext,
      })
    : {
        answer: await createDirectSiteChat({
          userId: user.id,
          message,
          history: body?.history,
          clientContext: body?.clientContext,
          enableThinking: body?.enableThinking === true,
        }),
        sources: [],
      };
  return c.json(createResponse(result), 200);
});

aiRouter.post('/agent/stream', authenticateJWT, bodyTypeCheck, async (c: HonoContext) => {
  const user = c.get('user') as User;
  const memoryAccessError = await getAiMemoryAccessError(user);
  if (memoryAccessError) {
    return c.json(
      createResponse(null, memoryAccessError),
      getAiMemoryErrorStatus(memoryAccessError)
    );
  }

  const body = await c.req.json();
  const message = String(body?.message || '').trim();

  if (!message) {
    return c.json(createResponse(null, 'Message is required'), 400);
  }

  return streamSSE(c, async (stream) => {
    try {
      await stream.write(': connected\n\n');
      const config = await getStoredAiConfig();
      if (!config.enabled) {
        throw new Error('AI is disabled');
      }

      await runRoteAgentStream({
        userId: user.id,
        request: {
          message,
          mode: body?.mode,
          history: body?.history,
          state: body?.state,
          selectedContext: body?.selectedContext,
          clientContext: body?.clientContext,
          debug: body?.debug,
          limit: body?.limit,
          previousPlan: body?.previousPlan,
          excludeIds: body?.excludeIds,
          pendingPlan: body?.pendingPlan,
          clarificationAnswer: body?.clarificationAnswer,
          enableThinking: body?.enableThinking === true,
        },
        config,
        emit: (event) => writeAgentSseEvent(stream, event),
      });
    } catch (error: any) {
      console.error('AI agent stream failed:', error);
      await writeSseEvent(stream, 'error', {
        message: 'AI agent stream failed',
      });
    }
  });
});

aiRouter.post('/chat/stream', authenticateJWT, bodyTypeCheck, async (c: HonoContext) => {
  const user = c.get('user') as User;
  const access = await getUserAiAccess(user);
  const accessError = getAiAccessErrorFromAccess(access);
  if (accessError) {
    return c.json(createResponse(null, accessError), 403);
  }

  const body = await c.req.json();
  const message = String(body?.message || '').trim();

  if (!message) {
    return c.json(createResponse(null, 'Message is required'), 400);
  }

  return streamSSE(c, async (stream) => {
    try {
      await stream.write(': connected\n\n');
      const [config, vectorStatus] = await Promise.all([getStoredAiConfig(), getPgvectorStatus()]);
      if (isAiMemoryAvailableForAccess({ access, config, vectorStatus })) {
        await streamToolPlannedChatResponse(stream, user, body, message);
      } else {
        await streamDirectSiteChat({
          userId: user.id,
          message,
          history: body?.history,
          clientContext: body?.clientContext,
          enableThinking: body?.enableThinking === true,
          onReasoning: (text) => writeSseEvent(stream, 'thinking', { phase: 'answer', text }),
          onContent: (text) => writeSseEvent(stream, 'delta', { text }),
          onUsage: (usage) => writeSseEvent(stream, 'usage', { phase: 'answer', usage }),
        });
        await writeSseEvent(stream, 'done', {});
      }
    } catch (error: any) {
      console.error('AI stream failed:', error);
      await writeSseEvent(stream, 'error', {
        message: 'AI stream failed',
      });
    }
  });
});

export default aiRouter;
