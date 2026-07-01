import { randomUUID } from 'crypto';
import { getUploadExtension } from '../attachments/uploadKeys';
import { getAttachmentUploadPolicy } from '../attachments/uploadPolicy';
import type { HonoContext } from '../types/hono';
import {
  MAX_FILES,
  getMediaKindFromContentType,
  isImageContentType,
  isVideoContentType,
  validateContentType,
  validateFileSize,
} from '../utils/fileValidation';
import { presignPutUrl } from '../utils/r2';
import { AttachmentPresignZod } from '../utils/zod';
import type { PresignFileInput } from './attachmentSupport';
import mcpErrors from './errorCodes.json';
import { requireStorageAvailable } from './attachmentSupport';
import { requireAuth } from './shared';

function validatePresignFile(file: PresignFileInput, maxVideoUploadSizeMB: number) {
  validateContentType(file.contentType);
  if (file.mediaKind !== 'livePhoto') {
    validateFileSize(file.size, file.contentType, maxVideoUploadSizeMB);
    return;
  }

  if (!isImageContentType(file.contentType)) {
    throw new Error(mcpErrors.livePhotoOriginalNotImage);
  }
  if (!file.pairedVideo) {
    throw new Error(mcpErrors.livePhotoPairedVideoRequired);
  }
  validateContentType(file.pairedVideo.contentType);
  if (!isVideoContentType(file.pairedVideo.contentType)) {
    throw new Error(mcpErrors.livePhotoPairedVideoNotVideo);
  }
  validateFileSize(file.size, file.contentType, maxVideoUploadSizeMB);
  validateFileSize(file.pairedVideo.size, file.pairedVideo.contentType, maxVideoUploadSizeMB);
}

export async function presignAttachments(c: HonoContext, args: Record<string, any>) {
  const auth = requireAuth(c);
  requireStorageAvailable();
  AttachmentPresignZod.parse(args);
  const files = args.files as PresignFileInput[];
  const uploadPolicy = await getAttachmentUploadPolicy(auth.userId);
  if (!uploadPolicy.canUploadAttachments) {
    throw new Error(mcpErrors.capabilityAttachmentUpload);
  }
  if (files.length > MAX_FILES) {
    throw new Error(mcpErrors.fileCountExceeded);
  }

  const hasVideo = files.some(
    (file) => isVideoContentType(file.contentType) || file.mediaKind === 'livePhoto'
  );
  if (hasVideo && !auth.scopes.includes('video:upload')) {
    throw new Error(mcpErrors.insufficientVideoUpload);
  }
  if (hasVideo && !uploadPolicy.canUploadVideo) {
    throw new Error(mcpErrors.capabilityVideoUpload);
  }

  files.forEach((file) => validatePresignFile(file, uploadPolicy.maxVideoUploadSizeMB));

  const items = await Promise.all(
    files.map(async (file) => {
      const uuid = randomUUID();
      const ext = getUploadExtension(file.filename, file.contentType);
      const originalKey = 'users/' + auth.userId + '/uploads/' + uuid + ext;
      const mediaKind =
        file.mediaKind === 'livePhoto'
          ? 'livePhoto'
          : getMediaKindFromContentType(file.contentType);
      const original = await presignPutUrl(originalKey, file.contentType || undefined, 15 * 60);
      const result: Record<string, any> = {
        uuid,
        original: {
          key: originalKey,
          putUrl: original.putUrl,
          url: original.url,
          contentType: file.contentType,
        },
      };

      if (mediaKind === 'image' || mediaKind === 'livePhoto') {
        const compressedKey = 'users/' + auth.userId + '/compressed/' + uuid + '.webp';
        const compressed = await presignPutUrl(compressedKey, 'image/webp', 15 * 60);
        result.compressed = {
          key: compressedKey,
          putUrl: compressed.putUrl,
          url: compressed.url,
          contentType: 'image/webp',
        };
      }

      if (mediaKind === 'livePhoto') {
        const pairedVideo = file.pairedVideo;
        if (!pairedVideo) throw new Error(mcpErrors.livePhotoPairedVideoRequired);
        const pairedVideoExt = getUploadExtension(pairedVideo.filename, pairedVideo.contentType);
        const pairedVideoKey = 'users/' + auth.userId + '/paired-videos/' + uuid + pairedVideoExt;
        const pairedVideoUpload = await presignPutUrl(
          pairedVideoKey,
          pairedVideo.contentType || undefined,
          15 * 60
        );
        result.pairedVideo = {
          key: pairedVideoKey,
          putUrl: pairedVideoUpload.putUrl,
          url: pairedVideoUpload.url,
          contentType: pairedVideo.contentType,
        };
      }

      if (mediaKind === 'video') {
        const posterKey = 'users/' + auth.userId + '/posters/' + uuid + '.jpg';
        const poster = await presignPutUrl(posterKey, 'image/jpeg', 15 * 60);
        result.poster = {
          key: posterKey,
          putUrl: poster.putUrl,
          url: poster.url,
          contentType: 'image/jpeg',
        };
      }

      return result;
    })
  );

  return { items };
}
