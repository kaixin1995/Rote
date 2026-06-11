import { randomUUID } from 'crypto';
import { Hono } from 'hono';
import {
  extractCompressedUuid,
  extractOriginalUploadUuid,
  extractPairedVideoUuid,
  extractPosterUuid,
  getUploadExtension,
} from '../../attachments/uploadKeys';
import { getAttachmentUploadPolicy } from '../../attachments/uploadPolicy';
import type { User } from '../../drizzle/schema';
import { requireStorageConfig } from '../../middleware/configCheck';
import { authenticateJWT } from '../../middleware/jwtAuth';
import type { StorageConfig } from '../../types/config';
import type { HonoContext, HonoVariables } from '../../types/hono';
import type { UploadResult } from '../../types/main';
import { getGlobalConfig } from '../../utils/config';
import {
  deleteAttachment,
  deleteAttachments,
  getAttachmentDetailsByRoteId,
  updateAttachmentsSortOrder,
  upsertAttachmentsByOriginalKey,
} from '../../utils/dbMethods';
import {
  MAX_BATCH_SIZE,
  MAX_FILES,
  getMediaKindFromContentType,
  inferAttachmentMediaKind,
  isImageContentType,
  isVideoContentType,
  mergeUniqueRoteAttachmentDetails,
  validateContentType,
  validateFileSize,
  validateRoteAttachmentDetails,
} from '../../utils/fileValidation';
import { createResponse, isValidUUID } from '../../utils/main';
import { checkObjectExists, presignPutUrl } from '../../utils/r2';
import { AttachmentPresignZod } from '../../utils/zod';

// 附件相关路由
const attachmentsRouter = new Hono<{ Variables: HonoVariables }>();

type PresignFileInput = {
  filename?: string;
  contentType?: string;
  size?: number;
  mediaKind?: 'image' | 'video' | 'livePhoto';
  pairedVideo?: {
    filename?: string;
    contentType?: string;
    size?: number;
  };
};

type FinalizeAttachmentInput = {
  uuid: string;
  originalKey: string;
  compressedKey?: string;
  posterKey?: string;
  pairedVideoKey?: string;
  pairedVideoSize?: number;
  pairedVideoMimetype?: string;
  pairedVideoFilename?: string;
  size?: number;
  mimetype?: string;
  mediaKind?: 'image' | 'video' | 'livePhoto';
  hash?: string;
  noteId?: string;
};
// 删除单个附件
attachmentsRouter.delete('/:id', authenticateJWT, async (c: HonoContext) => {
  const user = c.get('user') as User;
  const id = c.req.param('id');

  if (!id || !isValidUUID(id)) {
    throw new Error('Invalid attachment ID');
  }

  const data = await deleteAttachment(id, user.id);
  return c.json(createResponse(data), 200);
});

// 批量删除附件
attachmentsRouter.delete('/', authenticateJWT, async (c: HonoContext) => {
  const user = c.get('user') as User;
  const body = await c.req.json();
  const { ids } = body;

  if (!ids || ids.length === 0) {
    throw new Error('No attachments to delete');
  }

  // 限制批量删除的数量，防止滥用
  if (ids.length > MAX_BATCH_SIZE) {
    throw new Error(`Maximum ${MAX_BATCH_SIZE} attachments can be deleted at once`);
  }

  const data = await deleteAttachments(
    ids.map((id: string) => ({ id })),
    user.id
  );
  return c.json(createResponse(data), 200);
});

// 更新附件排序
attachmentsRouter.put('/sort', authenticateJWT, async (c: HonoContext) => {
  const user = c.get('user') as User;
  const body = await c.req.json();
  const { roteId, attachmentIds } = body as {
    roteId: string;
    attachmentIds: string[];
  };

  if (!roteId || !isValidUUID(roteId)) {
    throw new Error('Invalid rote ID');
  }

  if (!attachmentIds || !Array.isArray(attachmentIds) || attachmentIds.length === 0) {
    throw new Error('Invalid attachment IDs');
  }

  // 限制批量更新的数量，防止滥用
  if (attachmentIds.length > MAX_BATCH_SIZE) {
    throw new Error(`Maximum ${MAX_BATCH_SIZE} attachments can be sorted at once`);
  }

  // 验证所有附件ID格式
  for (const id of attachmentIds) {
    if (!isValidUUID(id)) {
      throw new Error(`Invalid attachment ID: ${id}`);
    }
  }

  const data = await updateAttachmentsSortOrder(user.id, roteId, attachmentIds);
  return c.json(createResponse(data), 200);
});

// 预签名直传（前端直接 PUT 到 R2）
attachmentsRouter.post(
  '/presign',
  authenticateJWT,
  requireStorageConfig,
  async (c: HonoContext) => {
    const user = c.get('user') as User;
    const uploadPolicy = await getAttachmentUploadPolicy(user.id);
    if (!uploadPolicy.canUploadAttachments) {
      return c.json(createResponse(null, 'capability_required:attachment.upload'), 403);
    }
    const body = await c.req.json();
    const { files } = body as {
      files: PresignFileInput[];
    };

    // 验证输入长度和格式
    AttachmentPresignZod.parse(body);

    // 验证文件数量限制（zod 已经验证，但保留作为双重检查）
    if (files.length > MAX_FILES) {
      throw new Error(`Maximum ${MAX_FILES} files allowed`);
    }

    const hasVideo = files.some(
      (f) => isVideoContentType(f.contentType) || f.mediaKind === 'livePhoto'
    );
    if (hasVideo && !uploadPolicy.canUploadVideo) {
      return c.json(createResponse(null, 'capability_required:attachment.video.upload'), 403);
    }

    // 严格验证每个文件的内容类型和大小
    for (const f of files) {
      validateContentType(f.contentType);

      if (f.mediaKind === 'livePhoto') {
        if (!isImageContentType(f.contentType)) {
          throw new Error('Live Photo original resource must be an image');
        }
        if (!f.pairedVideo) {
          throw new Error('Live Photo paired video is required');
        }
        validateContentType(f.pairedVideo.contentType);
        if (!isVideoContentType(f.pairedVideo.contentType)) {
          throw new Error('Live Photo paired video resource must be a video');
        }
        validateFileSize(f.size, f.contentType, uploadPolicy.maxVideoUploadSizeMB);
        validateFileSize(
          f.pairedVideo.size,
          f.pairedVideo.contentType,
          uploadPolicy.maxVideoUploadSizeMB
        );
        continue;
      }

      validateFileSize(f.size, f.contentType, uploadPolicy.maxVideoUploadSizeMB);
    }

    const results = await Promise.all(
      files.map(async (f) => {
        const uuid = randomUUID();
        const ext = getUploadExtension(f.filename, f.contentType);
        const originalKey = `users/${user.id}/uploads/${uuid}${ext}`;
        const mediaKind =
          f.mediaKind === 'livePhoto' ? 'livePhoto' : getMediaKindFromContentType(f.contentType);
        const original = await presignPutUrl(originalKey, f.contentType || undefined, 15 * 60);

        const result: Record<string, any> = {
          uuid,
          original: {
            key: originalKey,
            putUrl: original.putUrl,
            url: original.url,
            contentType: f.contentType,
          },
        };

        if (mediaKind === 'image' || mediaKind === 'livePhoto') {
          const compressedKey = `users/${user.id}/compressed/${uuid}.webp`;
          const compressed = await presignPutUrl(compressedKey, 'image/webp', 15 * 60);
          result.compressed = {
            key: compressedKey,
            putUrl: compressed.putUrl,
            url: compressed.url,
            contentType: 'image/webp',
          };
        }

        if (mediaKind === 'livePhoto') {
          const pairedVideo = f.pairedVideo;
          if (!pairedVideo) {
            throw new Error('Live Photo paired video is required');
          }
          const pairedVideoExt = getUploadExtension(pairedVideo.filename, pairedVideo.contentType);
          const pairedVideoKey = `users/${user.id}/paired-videos/${uuid}${pairedVideoExt}`;
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
          const posterKey = `users/${user.id}/posters/${uuid}.jpg`;
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

    return c.json(createResponse({ items: results }), 200);
  }
);

// 完成回调：将已上传对象入库（可选绑定 noteId）
attachmentsRouter.post(
  '/finalize',
  authenticateJWT,
  requireStorageConfig,
  async (c: HonoContext) => {
    const user = c.get('user') as User;
    const uploadPolicy = await getAttachmentUploadPolicy(user.id);
    if (!uploadPolicy.canUploadAttachments) {
      return c.json(createResponse(null, 'capability_required:attachment.upload'), 403);
    }
    const body = await c.req.json();
    const { attachments, noteId } = body as {
      attachments: FinalizeAttachmentInput[];
      noteId?: string;
    };

    if (!attachments || !Array.isArray(attachments) || attachments.length === 0) {
      throw new Error('No attachments to finalize');
    }

    // 限制批量完成的数量，防止滥用
    if (attachments.length > MAX_BATCH_SIZE) {
      throw new Error(`Maximum ${MAX_BATCH_SIZE} attachments can be finalized at once`);
    }

    // 简单的所有权校验：Key 必须在当前用户前缀下
    const prefix = `users/${user.id}/`;
    const invalid = attachments.find(
      (a) =>
        !a.originalKey?.startsWith(prefix) ||
        (a.compressedKey !== undefined && !a.compressedKey.startsWith(prefix)) ||
        (a.posterKey !== undefined && !a.posterKey.startsWith(prefix)) ||
        (a.pairedVideoKey !== undefined && !a.pairedVideoKey.startsWith(prefix))
    );
    if (invalid) {
      throw new Error('Invalid object key');
    }

    // 验证 mimetype（如果提供）
    for (const a of attachments) {
      if (a.mimetype) {
        validateContentType(a.mimetype);
        validateFileSize(a.size, a.mimetype, uploadPolicy.maxVideoUploadSizeMB);
      }

      if (a.mediaKind === 'livePhoto' || a.pairedVideoKey) {
        if (!isImageContentType(a.mimetype)) {
          throw new Error('Live Photo original resource must be an image');
        }
        validateContentType(a.pairedVideoMimetype);
        if (!isVideoContentType(a.pairedVideoMimetype)) {
          throw new Error('Live Photo paired video resource must be a video');
        }
        validateFileSize(
          a.pairedVideoSize,
          a.pairedVideoMimetype,
          uploadPolicy.maxVideoUploadSizeMB
        );
      }
    }

    const hasVideo = attachments.some(
      (a) =>
        inferAttachmentMediaKind({
          mediaKind: a.mediaKind,
          mimetype: a.mimetype,
          compressedKey: a.compressedKey,
          posterKey: a.posterKey,
          pairedVideoKey: a.pairedVideoKey,
          key: a.originalKey,
        }) === 'video' ||
        a.mediaKind === 'livePhoto' ||
        !!a.pairedVideoKey
    );
    if (hasVideo && !uploadPolicy.canUploadVideo) {
      return c.json(createResponse(null, 'capability_required:attachment.video.upload'), 403);
    }

    // 验证文件存在性和 UUID 一致性
    const validationErrors: string[] = [];
    const validAttachments: typeof attachments = [];

    for (const a of attachments) {
      const mediaKind = inferAttachmentMediaKind({
        mediaKind: a.mediaKind,
        mimetype: a.mimetype,
        compressedKey: a.compressedKey,
        posterKey: a.posterKey,
        pairedVideoKey: a.pairedVideoKey,
        key: a.originalKey,
      });

      const normalizedAttachment = { ...a };

      // 1. 验证原图文件是否存在
      const originalExists = await checkObjectExists(a.originalKey);
      if (!originalExists) {
        validationErrors.push(`Original file not found: ${a.originalKey} (uuid: ${a.uuid})`);
        continue;
      }

      const originalUuid = extractOriginalUploadUuid(a.originalKey);
      if (!originalUuid) {
        validationErrors.push(
          `Invalid original key format for uuid validation: originalKey=${a.originalKey}`
        );
        continue;
      }

      if (originalUuid !== a.uuid) {
        validationErrors.push(
          `UUID mismatch: request uuid '${a.uuid}' does not match originalKey uuid '${originalUuid}'`
        );
        continue;
      }

      // 2. 视频不接受 compressedKey
      if (mediaKind === 'video' && normalizedAttachment.compressedKey) {
        validationErrors.push(
          `Videos cannot include compressedKey: ${a.originalKey} (uuid: ${a.uuid})`
        );
        continue;
      }

      if ((mediaKind === 'image' || mediaKind === 'livePhoto') && normalizedAttachment.posterKey) {
        validationErrors.push(
          `Image-like attachments cannot include posterKey: ${a.originalKey} (uuid: ${a.uuid})`
        );
        normalizedAttachment.posterKey = undefined;
      }

      if (
        (mediaKind === 'image' || mediaKind === 'livePhoto') &&
        normalizedAttachment.compressedKey
      ) {
        const compressedExists = await checkObjectExists(normalizedAttachment.compressedKey);
        if (!compressedExists) {
          validationErrors.push(
            `Compressed file not found: ${normalizedAttachment.compressedKey} (uuid: ${a.uuid})`
          );
          normalizedAttachment.compressedKey = undefined;
        } else {
          const compressedUuid = extractCompressedUuid(normalizedAttachment.compressedKey);

          if (!compressedUuid) {
            validationErrors.push(
              `Invalid key format for uuid validation: originalKey=${a.originalKey}, compressedKey=${normalizedAttachment.compressedKey}`
            );
            normalizedAttachment.compressedKey = undefined;
          } else if (originalUuid !== compressedUuid) {
            validationErrors.push(
              `UUID mismatch: originalKey contains uuid '${originalUuid}', but compressedKey contains uuid '${compressedUuid}'`
            );
            normalizedAttachment.compressedKey = undefined;
          }
        }
      }

      if (mediaKind === 'livePhoto') {
        if (!normalizedAttachment.pairedVideoKey) {
          validationErrors.push(
            `Live Photo paired video missing: ${a.originalKey} (uuid: ${a.uuid})`
          );
          continue;
        }

        const pairedVideoExists = await checkObjectExists(normalizedAttachment.pairedVideoKey);
        if (!pairedVideoExists) {
          validationErrors.push(
            `Live Photo paired video not found: ${normalizedAttachment.pairedVideoKey} (uuid: ${a.uuid})`
          );
          continue;
        }

        const pairedVideoUuid = extractPairedVideoUuid(normalizedAttachment.pairedVideoKey);
        if (!pairedVideoUuid) {
          validationErrors.push(
            `Invalid paired video key format: originalKey=${a.originalKey}, pairedVideoKey=${normalizedAttachment.pairedVideoKey}`
          );
          continue;
        }

        if (originalUuid !== pairedVideoUuid) {
          validationErrors.push(
            `UUID mismatch: originalKey contains uuid '${originalUuid}', but pairedVideoKey contains uuid '${pairedVideoUuid}'`
          );
          continue;
        }
      } else if (normalizedAttachment.pairedVideoKey) {
        validationErrors.push(
          `Only Live Photo attachments can include pairedVideoKey: ${a.originalKey} (uuid: ${a.uuid})`
        );
        continue;
      }

      if (mediaKind === 'video' && normalizedAttachment.posterKey) {
        const posterExists = await checkObjectExists(normalizedAttachment.posterKey);
        if (!posterExists) {
          validationErrors.push(
            `Poster file not found: ${normalizedAttachment.posterKey} (uuid: ${a.uuid})`
          );
          normalizedAttachment.posterKey = undefined;
        } else {
          const posterUuid = extractPosterUuid(normalizedAttachment.posterKey);
          if (!posterUuid) {
            validationErrors.push(
              `Invalid key format for uuid validation: originalKey=${a.originalKey}, posterKey=${normalizedAttachment.posterKey}`
            );
            normalizedAttachment.posterKey = undefined;
          } else if (originalUuid !== posterUuid) {
            validationErrors.push(
              `UUID mismatch: originalKey contains uuid '${originalUuid}', but posterKey contains uuid '${posterUuid}'`
            );
            normalizedAttachment.posterKey = undefined;
          }
        }
      }

      if (!mediaKind) {
        validationErrors.push(
          `Unsupported attachment media type: ${a.originalKey} (uuid: ${a.uuid})`
        );
        continue;
      }

      // 所有验证通过
      validAttachments.push(normalizedAttachment);
    }

    // 如果没有有效的附件，返回错误
    if (validAttachments.length === 0) {
      // 如果有验证错误，返回详细错误信息
      if (validationErrors.length > 0) {
        const errorMessage =
          validationErrors.length === 1
            ? validationErrors[0]
            : `${validationErrors.length} validation error(s): ${validationErrors.join('; ')}`;
        throw new Error(errorMessage);
      }
      throw new Error('No valid attachments to finalize after validation');
    }

    // 如果有验证错误但仍有有效附件，记录警告（部分成功）
    if (validationErrors.length > 0) {
      console.warn(
        `Some attachments failed validation (${validationErrors.length} error(s)), but ${validAttachments.length} attachment(s) will be finalized:`,
        validationErrors
      );
    }

    if (noteId) {
      const currentAttachments = await getAttachmentDetailsByRoteId(noteId);
      const pendingAttachments = validAttachments.map((a) => ({
        details: {
          key: a.originalKey,
          mimetype: a.mimetype || null,
          mediaKind: inferAttachmentMediaKind({
            mediaKind: a.mediaKind,
            mimetype: a.mimetype || null,
            compressedKey: a.compressedKey,
            posterKey: a.posterKey,
            pairedVideoKey: a.pairedVideoKey,
          }),
          compressKey: a.compressedKey,
          posterKey: a.posterKey,
          pairedVideoKey: a.pairedVideoKey,
        },
      }));
      validateRoteAttachmentDetails(
        mergeUniqueRoteAttachmentDetails(currentAttachments, pendingAttachments)
      );
    }

    const uploads: UploadResult[] = validAttachments.map((a) => {
      const storageConfig = getGlobalConfig<StorageConfig>('storage');
      const urlPrefix = storageConfig?.urlPrefix;
      const oUrl = `${urlPrefix}/${a.originalKey}`;
      const mediaKind = inferAttachmentMediaKind({
        mediaKind: a.mediaKind,
        mimetype: a.mimetype || null,
        compressedKey: a.compressedKey,
        posterKey: a.posterKey,
        pairedVideoKey: a.pairedVideoKey,
      });
      const cUrl =
        (mediaKind === 'image' || mediaKind === 'livePhoto') && a.compressedKey
          ? `${urlPrefix}/${a.compressedKey}`
          : null;
      const pUrl = mediaKind === 'video' && a.posterKey ? `${urlPrefix}/${a.posterKey}` : null;
      const pairedVideoUrl =
        mediaKind === 'livePhoto' && a.pairedVideoKey ? `${urlPrefix}/${a.pairedVideoKey}` : null;
      const baseDetails: any = {
        size: a.size || 0,
        mimetype: a.mimetype || null,
        mediaKind,
        mtime: new Date().toISOString(),
        key: a.originalKey,
      };
      if (a.compressedKey) baseDetails.compressKey = a.compressedKey;
      if (a.posterKey) baseDetails.posterKey = a.posterKey;
      if (pairedVideoUrl && a.pairedVideoKey) {
        baseDetails.pairedVideoKey = a.pairedVideoKey;
        baseDetails.pairedVideoUrl = pairedVideoUrl;
        baseDetails.pairedVideoMimetype = a.pairedVideoMimetype || null;
        baseDetails.pairedVideoSize = a.pairedVideoSize || 0;
        if (a.pairedVideoFilename) {
          baseDetails.pairedVideoFilename = a.pairedVideoFilename;
        }
      }
      if (a.hash) baseDetails.hash = a.hash;

      return {
        url: oUrl,
        compressUrl: cUrl,
        posterUrl: pUrl,
        details: baseDetails,
      };
    });

    const data = await upsertAttachmentsByOriginalKey(
      user.id,
      (noteId as string | undefined) || undefined,
      uploads
    );

    return c.json(createResponse(data), 201);
  }
);

export default attachmentsRouter;
