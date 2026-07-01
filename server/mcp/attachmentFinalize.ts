import { getAttachmentUploadPolicy } from '../attachments/uploadPolicy';
import type { HonoContext } from '../types/hono';
import type { UploadResult } from '../types/main';
import {
  extractCompressedUuid,
  extractOriginalUploadUuid,
  extractPairedVideoUuid,
  extractPosterUuid,
} from '../attachments/uploadKeys';
import { getAttachmentDetailsByRoteId, upsertAttachmentsByOriginalKey } from '../utils/dbMethods';
import {
  MAX_BATCH_SIZE,
  inferAttachmentMediaKind,
  isImageContentType,
  isVideoContentType,
  mergeUniqueRoteAttachmentDetails,
  validateContentType,
  validateFileSize,
  validateRoteAttachmentDetails,
} from '../utils/fileValidation';
import { checkObjectExists } from '../utils/r2';
import type { FinalizeAttachmentInput } from './attachmentSupport';
import mcpErrors from './errorCodes.json';
import { requireStorageAvailable } from './attachmentSupport';
import { requireAuth } from './shared';

function assertFinalizeInput(
  attachments: FinalizeAttachmentInput[] | undefined
): asserts attachments is FinalizeAttachmentInput[] {
  if (!attachments || !Array.isArray(attachments) || attachments.length === 0) {
    throw new Error(mcpErrors.attachmentsRequired);
  }
  if (attachments.length > MAX_BATCH_SIZE) {
    throw new Error(mcpErrors.attachmentBatchLimitExceeded);
  }
}

function validateAttachmentPayload(item: FinalizeAttachmentInput, maxVideoUploadSizeMB: number) {
  if (item.mimetype) {
    validateContentType(item.mimetype);
    validateFileSize(item.size, item.mimetype, maxVideoUploadSizeMB);
  }
  if (item.mediaKind === 'livePhoto' || item.pairedVideoKey) {
    if (!isImageContentType(item.mimetype)) throw new Error(mcpErrors.livePhotoOriginalNotImage);
    validateContentType(item.pairedVideoMimetype);
    if (!isVideoContentType(item.pairedVideoMimetype))
      throw new Error(mcpErrors.livePhotoPairedVideoNotVideo);
    validateFileSize(item.pairedVideoSize, item.pairedVideoMimetype, maxVideoUploadSizeMB);
  }
}

async function collectValidAttachments(attachments: FinalizeAttachmentInput[]) {
  const validationErrors: string[] = [];
  const validAttachments: FinalizeAttachmentInput[] = [];
  for (const item of attachments) {
    const mediaKind = inferAttachmentMediaKind({
      mediaKind: item.mediaKind,
      mimetype: item.mimetype,
      compressedKey: item.compressedKey,
      posterKey: item.posterKey,
      pairedVideoKey: item.pairedVideoKey,
      key: item.originalKey,
    });
    const normalizedAttachment = { ...item };
    const originalExists = await checkObjectExists(item.originalKey);
    if (!originalExists) {
      validationErrors.push(
        mcpErrors.originalFileNotFoundPrefix + item.originalKey + ':' + item.uuid
      );
      continue;
    }

    const originalUuid = extractOriginalUploadUuid(item.originalKey);
    if (!originalUuid || originalUuid !== item.uuid) {
      validationErrors.push(mcpErrors.uuidMismatchPrefix + item.originalKey);
      continue;
    }
    if (mediaKind === 'video' && normalizedAttachment.compressedKey) {
      validationErrors.push(mcpErrors.videoCompressedKeyForbiddenPrefix + item.originalKey);
      continue;
    }
    if ((mediaKind === 'image' || mediaKind === 'livePhoto') && normalizedAttachment.posterKey) {
      normalizedAttachment.posterKey = undefined;
    }
    if (
      (mediaKind === 'image' || mediaKind === 'livePhoto') &&
      normalizedAttachment.compressedKey
    ) {
      const compressedExists = await checkObjectExists(normalizedAttachment.compressedKey);
      const compressedUuid = extractCompressedUuid(normalizedAttachment.compressedKey);
      if (!compressedExists || !compressedUuid || originalUuid !== compressedUuid) {
        validationErrors.push(
          mcpErrors.compressedFileInvalidPrefix + normalizedAttachment.compressedKey
        );
        normalizedAttachment.compressedKey = undefined;
      }
    }
    if (mediaKind === 'livePhoto') {
      if (!normalizedAttachment.pairedVideoKey) {
        validationErrors.push(mcpErrors.livePhotoPairedVideoMissingPrefix + item.originalKey);
        continue;
      }
      const pairedVideoExists = await checkObjectExists(normalizedAttachment.pairedVideoKey);
      const pairedVideoUuid = extractPairedVideoUuid(normalizedAttachment.pairedVideoKey);
      if (!pairedVideoExists || !pairedVideoUuid || originalUuid !== pairedVideoUuid) {
        validationErrors.push(
          mcpErrors.livePhotoPairedVideoInvalidPrefix + normalizedAttachment.pairedVideoKey
        );
        continue;
      }
    } else if (normalizedAttachment.pairedVideoKey) {
      validationErrors.push(mcpErrors.pairedVideoLivePhotoOnlyPrefix + item.originalKey);
      continue;
    }
    if (mediaKind === 'video' && normalizedAttachment.posterKey) {
      const posterExists = await checkObjectExists(normalizedAttachment.posterKey);
      const posterUuid = extractPosterUuid(normalizedAttachment.posterKey);
      if (!posterExists || !posterUuid || originalUuid !== posterUuid) {
        validationErrors.push(mcpErrors.posterFileInvalidPrefix + normalizedAttachment.posterKey);
        normalizedAttachment.posterKey = undefined;
      }
    }
    if (!mediaKind) {
      validationErrors.push(mcpErrors.attachmentMediaUnsupportedPrefix + item.originalKey);
      continue;
    }
    validAttachments.push(normalizedAttachment);
  }

  if (validAttachments.length === 0) {
    const message =
      validationErrors.length === 1
        ? validationErrors[0]
        : mcpErrors.attachmentValidationErrorsPrefix + validationErrors.join(';');
    throw new Error(message || mcpErrors.attachmentValidationFailed);
  }
  return validAttachments;
}

function toUploadResult(urlPrefix: string, item: FinalizeAttachmentInput): UploadResult {
  const mediaKind = inferAttachmentMediaKind({
    mediaKind: item.mediaKind,
    mimetype: item.mimetype || null,
    compressedKey: item.compressedKey,
    posterKey: item.posterKey,
    pairedVideoKey: item.pairedVideoKey,
  });
  const pairedVideoUrl =
    mediaKind === 'livePhoto' && item.pairedVideoKey ? urlPrefix + '/' + item.pairedVideoKey : null;
  const details: any = {
    size: item.size || 0,
    mimetype: item.mimetype || null,
    mediaKind,
    mtime: new Date().toISOString(),
    key: item.originalKey,
  };
  if (item.compressedKey) details.compressKey = item.compressedKey;
  if (item.posterKey) details.posterKey = item.posterKey;
  if (pairedVideoUrl && item.pairedVideoKey) {
    details.pairedVideoKey = item.pairedVideoKey;
    details.pairedVideoUrl = pairedVideoUrl;
    details.pairedVideoMimetype = item.pairedVideoMimetype || null;
    details.pairedVideoSize = item.pairedVideoSize || 0;
    if (item.pairedVideoFilename) details.pairedVideoFilename = item.pairedVideoFilename;
  }
  if (item.hash) details.hash = item.hash;

  return {
    url: urlPrefix + '/' + item.originalKey,
    compressUrl:
      (mediaKind === 'image' || mediaKind === 'livePhoto') && item.compressedKey
        ? urlPrefix + '/' + item.compressedKey
        : null,
    posterUrl: mediaKind === 'video' && item.posterKey ? urlPrefix + '/' + item.posterKey : null,
    details,
  };
}

export async function finalizeAttachments(c: HonoContext, args: Record<string, any>) {
  const auth = requireAuth(c);
  const storageConfig = requireStorageAvailable();
  const uploadPolicy = await getAttachmentUploadPolicy(auth.userId);
  if (!uploadPolicy.canUploadAttachments) throw new Error(mcpErrors.capabilityAttachmentUpload);

  const attachments = args.attachments as FinalizeAttachmentInput[] | undefined;
  const noteId = typeof args.noteId === 'string' ? args.noteId : undefined;
  assertFinalizeInput(attachments);
  const prefix = 'users/' + auth.userId + '/';
  const invalid = attachments.find(
    (item) =>
      !item.originalKey?.startsWith(prefix) ||
      (item.compressedKey !== undefined && !item.compressedKey.startsWith(prefix)) ||
      (item.posterKey !== undefined && !item.posterKey.startsWith(prefix)) ||
      (item.pairedVideoKey !== undefined && !item.pairedVideoKey.startsWith(prefix))
  );
  if (invalid) throw new Error(mcpErrors.objectKeyInvalid);
  attachments.forEach((item) => validateAttachmentPayload(item, uploadPolicy.maxVideoUploadSizeMB));

  const hasVideo = attachments.some(
    (item) =>
      inferAttachmentMediaKind({
        mediaKind: item.mediaKind,
        mimetype: item.mimetype,
        compressedKey: item.compressedKey,
        posterKey: item.posterKey,
        pairedVideoKey: item.pairedVideoKey,
        key: item.originalKey,
      }) === 'video' ||
      item.mediaKind === 'livePhoto' ||
      !!item.pairedVideoKey
  );
  if (hasVideo && !auth.scopes.includes('video:upload'))
    throw new Error(mcpErrors.insufficientVideoUpload);
  if (hasVideo && !uploadPolicy.canUploadVideo) throw new Error(mcpErrors.capabilityVideoUpload);

  const validAttachments = await collectValidAttachments(attachments);
  if (noteId) {
    const currentAttachments = await getAttachmentDetailsByRoteId(noteId);
    const pendingAttachments = validAttachments.map((item) => ({
      details: {
        key: item.originalKey,
        mimetype: item.mimetype || null,
        mediaKind: inferAttachmentMediaKind({
          mediaKind: item.mediaKind,
          mimetype: item.mimetype || null,
          compressedKey: item.compressedKey,
          posterKey: item.posterKey,
          pairedVideoKey: item.pairedVideoKey,
        }),
        compressKey: item.compressedKey,
        posterKey: item.posterKey,
        pairedVideoKey: item.pairedVideoKey,
      },
    }));
    validateRoteAttachmentDetails(
      mergeUniqueRoteAttachmentDetails(currentAttachments, pendingAttachments)
    );
  }

  const uploads = validAttachments.map((item) => toUploadResult(storageConfig.urlPrefix, item));
  return await upsertAttachmentsByOriginalKey(auth.userId, noteId, uploads);
}
