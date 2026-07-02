import { finalizeAttachmentUploads } from '../attachments/finalizeUpload';
import type { FinalizeAttachmentInput } from '../attachments/types';
import type { HonoContext } from '../types/hono';
import { requireAuth } from './shared';

export async function finalizeAttachments(c: HonoContext, args: Record<string, any>) {
  const auth = requireAuth(c);
  return await finalizeAttachmentUploads({
    userId: auth.userId,
    scopes: auth.scopes,
    noteId: typeof args.noteId === 'string' ? args.noteId : undefined,
    attachments: args.attachments as FinalizeAttachmentInput[] | undefined,
  });
}
