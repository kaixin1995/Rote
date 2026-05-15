import ExportCard from '@/components/article/ExportCard';
import { toBlob } from 'html-to-image';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

interface Author {
  nickname?: string;
  avatar?: string;
  username?: string;
}

interface UseArticleExportOptions {
  title: string;
  content: string;
  author?: Author;
}

// Ignore strict iOS canvas limits, focus on Chrome/PC limits for better quality.
const MAX_CANVAS_AREA = 160000000; // ~160M pixels
const MAX_DIMENSION = 65535;

function logExport(step: string, data?: Record<string, unknown>) {
  const ts = new Date().toISOString().slice(11, 23);
  const prefix = `[Export ${ts}]`;
  if (data) {
    // eslint-disable-next-line no-console
    console.log(`${prefix} ${step}`, data);
  } else {
    // eslint-disable-next-line no-console
    console.log(`${prefix} ${step}`);
  }
}

function logExportError(step: string, error?: unknown) {
  const ts = new Date().toISOString().slice(11, 23);
  const prefix = `[Export ${ts}]`;
  if (error instanceof Error) {
    // eslint-disable-next-line no-console
    console.error(`${prefix} ✗ ${step}`, { message: error.message, name: error.name });
  } else if (error) {
    // eslint-disable-next-line no-console
    console.error(`${prefix} ✗ ${step}`, error);
  } else {
    // eslint-disable-next-line no-console
    console.error(`${prefix} ✗ ${step}`);
  }
}

async function toDataURL(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

// Ensure all images in a container are loaded
async function waitForImagesToLoad(container: HTMLElement) {
  const images = Array.from(container.querySelectorAll('img'));
  const promises = images.map((img) => {
    if (img.complete) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => resolve(), 5000); // 5s timeout per image
      img.onload = () => {
        clearTimeout(timeout);
        resolve();
      };
      img.onerror = () => {
        clearTimeout(timeout);
        resolve(); // Ignore error, just continue
      };
    });
  });
  await Promise.all(promises);
}

export function useArticleExport() {
  const [exporting, setExporting] = useState(false);
  const { t } = useTranslation('translation', { keyPrefix: 'article.actions' });

  const handleExportImage = async ({ title, content, author }: UseArticleExportOptions) => {
    const exportId = Math.random().toString(36).slice(2, 8);

    if (!content) return;
    if (exporting) return;

    setExporting(true);

    try {
      logExport(`[${exportId}] Start`, {
        title: title?.slice(0, 40),
        contentLength: content.length,
      });

      // Resolve avatar
      let resolvedAuthor = author;
      if (author?.avatar) {
        try {
          resolvedAuthor = { ...author, avatar: await toDataURL(author.avatar) };
        } catch {
          resolvedAuthor = { ...author, avatar: '/DefaultAvatar.svg' };
        }
      }

      // Render card off-screen
      const container = document.createElement('div');
      container.style.cssText = 'position:fixed;left:-9999px;top:0;';
      document.body.appendChild(container);

      const root = createRoot(container);
      await new Promise<void>((resolve) => {
        root.render(
          <ExportCard
            title={title || 'Untitled'}
            content={content}
            author={resolvedAuthor}
            onReady={resolve}
          />
        );
      });

      const cardEl = container.firstElementChild as HTMLElement;
      if (!cardEl) throw new Error('Card not rendered');

      // Wait a bit to ensure React has fully committed the DOM
      await new Promise((r) => setTimeout(r, 100));

      // Wait for all images inside to load
      await waitForImagesToLoad(cardEl);

      // Measure and calculate safe scale
      const rect = cardEl.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;

      const currentArea = rect.width * rect.height;
      const maxAreaScale = Math.sqrt(MAX_CANVAS_AREA / currentArea);
      const maxDimScale = Math.min(MAX_DIMENSION / rect.width, MAX_DIMENSION / rect.height);

      // The maximum safe scale factor that won't exceed canvas limits
      const safeScale = Math.min(maxAreaScale, maxDimScale);

      // Force a high scale (e.g., 4x) so the exported image is always
      // retina-quality.
      let scale = 4;

      // If our preferred scale exceeds the safe limit, reduce it,
      // but ensure we round down to a clean number (e.g., 1.0, 1.5, 2.0)
      // to avoid fractional subpixel rendering artifacts which cause severe blurriness.
      if (scale > safeScale) {
        scale = Math.floor(safeScale * 2) / 2;
        if (scale < 1) scale = 1; // absolute minimum
      }

      logExport(`[${exportId}] Capturing`, {
        size: `${rect.width}x${rect.height}`,
        dpr,
        scale,
        outputPixels: `${rect.width * scale}x${rect.height * scale}`,
      });

      // To bypass the browser's SVG foreignObject height/GPU memory limit (which causes
      // extreme pixelation/blurriness on tall elements), we slice the capture into chunks.
      const CHUNK_HEIGHT = 2000;
      const chunksCount = Math.ceil(rect.height / CHUNK_HEIGHT);

      const masterCanvas = document.createElement('canvas');
      masterCanvas.width = rect.width * scale;
      masterCanvas.height = rect.height * scale;
      const masterCtx = masterCanvas.getContext('2d');
      if (!masterCtx) throw new Error('Cannot create master canvas context');
      // Disable smoothing to prevent seams
      masterCtx.imageSmoothingEnabled = false;

      for (let i = 0; i < chunksCount; i++) {
        const currentChunkHeight = Math.min(CHUNK_HEIGHT, rect.height - i * CHUNK_HEIGHT);

        const chunkBlob = await toBlob(cardEl, {
          pixelRatio: scale,
          backgroundColor: '#ffffff',
          width: rect.width,
          height: currentChunkHeight,
          style: {
            left: '0',
            top: '0',
            margin: '0',
            transform: `translateY(-${i * CHUNK_HEIGHT}px)`,
            transformOrigin: 'top left',
            WebkitFontSmoothing: 'antialiased',
            MozOsxFontSmoothing: 'grayscale',
          } as any,
        });

        if (!chunkBlob || chunkBlob.size === 0) throw new Error(`Empty image chunk ${i}`);

        const img = new Image();
        const url = URL.createObjectURL(chunkBlob);
        img.src = url;
        await new Promise((res, rej) => {
          img.onload = res;
          img.onerror = rej;
        });

        masterCtx.drawImage(
          img,
          0,
          i * CHUNK_HEIGHT * scale,
          rect.width * scale,
          currentChunkHeight * scale
        );
        URL.revokeObjectURL(url);
      }

      const finalBlob = await new Promise<Blob | null>((resolve) => {
        masterCanvas.toBlob(resolve, 'image/png');
      });

      if (!finalBlob || finalBlob.size === 0) throw new Error('Empty image');

      // Download
      const url = URL.createObjectURL(finalBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title || 'article'}.png`;
      a.click();
      URL.revokeObjectURL(url);

      logExport(`[${exportId}] Done`, { sizeKB: (finalBlob.size / 1024).toFixed(0) });
      toast.success(t('exportSuccess'));
    } catch (e) {
      logExportError(`[${exportId}] Failed`, e);
      toast.error(t('exportFailed'));
    } finally {
      // Cleanup
      document.body
        .querySelectorAll('[style*="left:-9999px"], [style*="left: -9999px"]')
        .forEach((el) => el.remove());
      setExporting(false);
    }
  };

  return { exporting, handleExportImage };
}
