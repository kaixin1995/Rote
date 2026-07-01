import type { HonoContext } from '../types/hono';
import {
  createRote,
  deleteEmbeddingsForSource,
  deleteRote,
  deleteRoteAttachmentsByRoteId,
  deleteRoteLinkPreviewsByRoteId,
  editRote,
  enqueueEmbeddingJob,
  findMyRote,
  findRoteById,
  findRotesByIds,
  searchMyRotes,
  setNoteArticleId,
} from '../utils/dbMethods';
import { MAX_BATCH_SIZE } from '../utils/fileValidation';
import { extractUrlsFromContent, parseAndStoreRoteLinkPreviews } from '../utils/linkPreview';
import { NoteCreateZod, NoteUpdateZod, SearchKeywordZod } from '../utils/zod';
import mcpErrors from './errorCodes.json';
import { defineMcpTool } from './registry';
import {
  assertUuid,
  buildNoteFilter,
  parseArchived,
  parseOptionalInteger,
  parseOptionalLimit,
  processTags,
  requireAuth,
} from './shared';
import type { McpTool } from './types';

async function createNote(c: HonoContext, args: Record<string, any>) {
  const auth = requireAuth(c);
  NoteCreateZod.parse(args);
  const result = await createRote({
    content: args.content,
    title: args.title || '',
    state: args.state || 'private',
    type: args.type || 'rote',
    tags: processTags(args.tags),
    pin: !!args.pin,
    archived: !!args.archived,
    editor: args.editor,
    authorid: auth.userId,
  });

  void enqueueEmbeddingJob('rote', result.id, auth.userId).catch((error) => {
    console.error('mcp_rote_embedding_enqueue_failed', error);
  });

  const articleIdToSet =
    typeof args.articleId === 'string'
      ? args.articleId
      : Array.isArray(args.articleIds) && args.articleIds.length > 0
        ? args.articleIds[0]
        : null;
  if (articleIdToSet) {
    await setNoteArticleId(result.id, articleIdToSet, auth.userId);
    return result;
  }

  void parseAndStoreRoteLinkPreviews(result.id, result.content).catch((error) => {
    console.error('mcp_link_preview_create_failed', error);
  });

  return result;
}

async function updateNote(c: HonoContext, args: Record<string, any>) {
  const auth = requireAuth(c);
  const id = assertUuid(args.id, 'note_id');
  NoteUpdateZod.parse(args);
  await editRote({ ...args, id, authorid: auth.userId });

  void enqueueEmbeddingJob('rote', id, auth.userId).catch((error) => {
    console.error('mcp_rote_embedding_enqueue_failed', error);
  });

  let articleIdToSet: string | null | undefined;
  if ('articleId' in args) {
    articleIdToSet = typeof args.articleId === 'string' ? args.articleId : (args.articleId ?? null);
  } else if (Array.isArray(args.articleIds)) {
    articleIdToSet = args.articleIds.length > 0 ? args.articleIds[0] : null;
  }

  if (articleIdToSet !== undefined) {
    await setNoteArticleId(id, articleIdToSet, auth.userId);
  }

  const data = await findRoteById(id);
  const hasArticle = Boolean(data?.articleId || data?.article);
  const contentProvided = Object.prototype.hasOwnProperty.call(args, 'content');
  const contentForPreview = contentProvided ? args.content : data?.content;

  if (hasArticle && articleIdToSet !== undefined) {
    await deleteRoteLinkPreviewsByRoteId(id);
  } else if (
    (contentProvided || articleIdToSet !== undefined) &&
    typeof contentForPreview === 'string'
  ) {
    const urls = extractUrlsFromContent(contentForPreview);
    await deleteRoteLinkPreviewsByRoteId(id);
    if (urls.length > 0 && !hasArticle) {
      void parseAndStoreRoteLinkPreviews(id, contentForPreview).catch((error) => {
        console.error('mcp_link_preview_update_failed', error);
      });
    }
  }

  return data;
}

export const noteTools: McpTool[] = [
  defineMcpTool('notes_create', createNote),
  defineMcpTool('notes_list', async (c, args) => {
    const auth = requireAuth(c);
    return await findMyRote(
      auth.userId,
      parseOptionalInteger(args.skip, 'skip'),
      parseOptionalLimit(args.limit),
      buildNoteFilter(args),
      parseArchived(args.archived)
    );
  }),
  defineMcpTool('notes_search', async (c, args) => {
    const auth = requireAuth(c);
    SearchKeywordZod.parse({ keyword: args.keyword });
    return await searchMyRotes(
      auth.userId,
      args.keyword,
      parseOptionalInteger(args.skip, 'skip'),
      parseOptionalLimit(args.limit),
      buildNoteFilter(args),
      parseArchived(args.archived)
    );
  }),
  defineMcpTool('notes_get', async (c, args) => {
    const auth = requireAuth(c);
    const id = assertUuid(args.id, 'note_id');
    const note = await findRoteById(id);
    if (!note) throw new Error(mcpErrors.noteNotFound);
    if (note.state === 'public' || note.authorid === auth.userId) return note;
    throw new Error(mcpErrors.notePrivate);
  }),
  defineMcpTool('notes_batch_get', async (c, args) => {
    const auth = requireAuth(c);
    const ids = args.ids as string[];
    if (!Array.isArray(ids) || ids.length === 0) throw new Error(mcpErrors.idsRequired);
    if (ids.length > MAX_BATCH_SIZE) throw new Error(mcpErrors.batchLimitExceeded);
    ids.forEach((id) => assertUuid(id, 'note_id'));
    const notes = await findRotesByIds(ids);
    return notes.filter((note) => note.state === 'public' || note.authorid === auth.userId);
  }),
  defineMcpTool('notes_update', updateNote),
  defineMcpTool('notes_delete', async (c, args) => {
    const auth = requireAuth(c);
    const id = assertUuid(args.id, 'note_id');
    const data = await deleteRote({ id, authorid: auth.userId });
    await deleteRoteAttachmentsByRoteId(id, auth.userId);
    void deleteEmbeddingsForSource('rote', id).catch((error) => {
      console.error('mcp_rote_embedding_delete_failed', error);
    });
    return data;
  }),
];
