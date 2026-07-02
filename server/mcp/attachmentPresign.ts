import { presignAttachmentUploads } from '../attachments/presignUpload';
import type { PresignFileInput } from '../attachments/types';
import { AttachmentPresignZod } from '../utils/zod';
import { requireAuth } from './shared';
import type { HonoContext } from '../types/hono';

export async function presignAttachments(c: HonoContext, args: Record<string, any>) {
  const auth = requireAuth(c);
  AttachmentPresignZod.parse(args);
  return await presignAttachmentUploads({
    userId: auth.userId,
    scopes: auth.scopes,
    files: args.files as PresignFileInput[],
  });
}
