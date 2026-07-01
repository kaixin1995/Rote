import {
  deleteAttachment,
  deleteAttachments,
  findRoteById,
  updateAttachmentsSortOrder,
} from '../utils/dbMethods';
import { MAX_BATCH_SIZE } from '../utils/fileValidation';
import { finalizeAttachments } from './attachmentFinalize';
import mcpErrors from './errorCodes.json';
import { presignAttachments } from './attachmentPresign';
import { defineMcpTool } from './registry';
import { assertUuid, requireAuth } from './shared';
import type { McpTool } from './types';

export const attachmentTools: McpTool[] = [
  defineMcpTool('attachments_presign_upload', presignAttachments),
  defineMcpTool('attachments_finalize_upload', finalizeAttachments),
  defineMcpTool('attachments_sort', async (c, args) => {
    const auth = requireAuth(c);
    const noteId = assertUuid(args.noteId, 'note_id');
    const attachmentIds = args.attachmentIds as string[];
    if (!Array.isArray(attachmentIds) || attachmentIds.length === 0)
      throw new Error(mcpErrors.attachmentIdsRequired);
    if (attachmentIds.length > MAX_BATCH_SIZE)
      throw new Error(mcpErrors.attachmentBatchLimitExceeded);
    attachmentIds.forEach((id) => assertUuid(id, 'attachment_id'));
    const note = await findRoteById(noteId);
    if (!note) throw new Error(mcpErrors.noteNotFound);
    if (note.authorid !== auth.userId) throw new Error(mcpErrors.noteOwnershipRequired);
    return await updateAttachmentsSortOrder(auth.userId, noteId, attachmentIds);
  }),
  defineMcpTool(
    'attachments_delete_one',
    async (c, args) =>
      await deleteAttachment(assertUuid(args.id, 'attachment_id'), requireAuth(c).userId)
  ),
  defineMcpTool('attachments_delete_many', async (c, args) => {
    const auth = requireAuth(c);
    const ids = args.ids as string[];
    if (!Array.isArray(ids) || ids.length === 0) throw new Error(mcpErrors.idsRequired);
    if (ids.length > MAX_BATCH_SIZE) throw new Error(mcpErrors.batchLimitExceeded);
    ids.forEach((id) => assertUuid(id, 'attachment_id'));
    return await deleteAttachments(
      ids.map((id) => ({ id })),
      auth.userId
    );
  }),
];
