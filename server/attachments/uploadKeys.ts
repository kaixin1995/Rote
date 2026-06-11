export function getUploadExtension(filename?: string, contentType?: string) {
  if (filename && filename.includes('.')) return `.${filename.split('.').pop()}`;
  if (!contentType) return '';

  const extensions: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/heic': '.heic',
    'image/heif': '.heif',
    'image/avif': '.avif',
    'image/svg+xml': '.svg',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
  };

  return extensions[contentType] || '';
}

export const extractOriginalUploadUuid = (key?: string) =>
  key?.match(/\/uploads\/([^/.]+)(\.[^.]+)?$/)?.[1] ?? null;

export const extractCompressedUuid = (key?: string) =>
  key?.match(/\/compressed\/([^/.]+)\.webp$/)?.[1] ?? null;

export const extractPosterUuid = (key?: string) =>
  key?.match(/\/posters\/([^/.]+)\.[^.]+$/)?.[1] ?? null;

export const extractPairedVideoUuid = (key?: string) =>
  key?.match(/\/paired-videos\/([^/.]+)\.[^.]+$/)?.[1] ?? null;
