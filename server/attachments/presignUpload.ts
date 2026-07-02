import { randomUUID } from 'crypto';
import { getUploadExtension } from './uploadKeys';
import { getAttachmentUploadPolicy } from './uploadPolicy';
import {
  MAX_FILES,
  getMediaKindFromContentType,
  isImageContentType,
  isVideoContentType,
  validateContentType,
  validateFileSize,
} from '../utils/fileValidation';
import { presignPutUrl } from '../utils/r2';
import type { PresignFileInput } from './types';
import { requireStorageAvailable } from './types';
import attachmentErrors from './errorCodes.json';

function validatePresignFile(file: PresignFileInput, maxVideoUploadSizeMB: number) {
  validateContentType(file.contentType);
  if (file.mediaKind !== 'livePhoto') {
    validateFileSize(file.size, file.contentType, maxVideoUploadSizeMB);
    return;
  }

  if (!isImageContentType(file.contentType)) {
    throw new Error(attachmentErrors.livePhotoOriginalNotImage);
  }
  if (!file.pairedVideo) {
    throw new Error(attachmentErrors.livePhotoPairedVideoRequired);
  }
  validateContentType(file.pairedVideo.contentType);
  if (!isVideoContentType(file.pairedVideo.contentType)) {
    throw new Error(attachmentErrors.livePhotoPairedVideoNotVideo);
  }
  validateFileSize(file.size, file.contentType, maxVideoUploadSizeMB);
  validateFileSize(file.pairedVideo.size, file.pairedVideo.contentType, maxVideoUploadSizeMB);
}

export async function presignAttachmentUploads(input: {
  userId: string;
  scopes: string[];
  files: PresignFileInput[];
}) {
  requireStorageAvailable();
  const uploadPolicy = await getAttachmentUploadPolicy(input.userId);
  if (!uploadPolicy.canUploadAttachments) {
    throw new Error(attachmentErrors.capabilityAttachmentUpload);
  }
  if (input.files.length > MAX_FILES) {
    throw new Error(attachmentErrors.fileCountExceeded);
  }

  const hasVideo = input.files.some(
    (file) => isVideoContentType(file.contentType) || file.mediaKind === 'livePhoto'
  );
  if (hasVideo && !input.scopes.includes('video:upload')) {
    throw new Error(attachmentErrors.insufficientVideoUpload);
  }
  if (hasVideo && !uploadPolicy.canUploadVideo) {
    throw new Error(attachmentErrors.capabilityVideoUpload);
  }

  input.files.forEach((file) => validatePresignFile(file, uploadPolicy.maxVideoUploadSizeMB));

  const items = await Promise.all(
    input.files.map(async (file) => {
      const uuid = randomUUID();
      const ext = getUploadExtension(file.filename, file.contentType);
      const originalKey = 'users/' + input.userId + '/uploads/' + uuid + ext;
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
        const compressedKey = 'users/' + input.userId + '/compressed/' + uuid + '.webp';
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
        if (!pairedVideo) throw new Error(attachmentErrors.livePhotoPairedVideoRequired);
        const pairedVideoExt = getUploadExtension(pairedVideo.filename, pairedVideo.contentType);
        const pairedVideoKey = 'users/' + input.userId + '/paired-videos/' + uuid + pairedVideoExt;
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
        const posterKey = 'users/' + input.userId + '/posters/' + uuid + '.jpg';
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
