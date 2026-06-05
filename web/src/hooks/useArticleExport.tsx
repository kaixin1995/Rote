import ExportCard from '@/components/article/ExportCard';
import {
  cleanupOffscreenContainers,
  exportElementToPng,
  logExport,
  logExportError,
  renderOffscreenExportElement,
  toDataURL,
} from '@/utils/exportImage';
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

export function useArticleExport() {
  const [exporting, setExporting] = useState(false);
  const { t } = useTranslation('translation', { keyPrefix: 'article.actions' });

  const handleExportImage = async ({ title, content, author }: UseArticleExportOptions) => {
    const exportId = Math.random().toString(36).slice(2, 8);

    if (!content) return;
    if (exporting) return;

    setExporting(true);
    let cleanupRenderedElement: (() => void) | undefined;

    try {
      logExport(`[${exportId}] Start`, {
        title: title?.slice(0, 40),
        contentLength: content.length,
      });

      let resolvedAuthor = author;
      if (author?.avatar) {
        try {
          resolvedAuthor = { ...author, avatar: await toDataURL(author.avatar) };
        } catch {
          resolvedAuthor = { ...author, avatar: '/DefaultAvatar.svg' };
        }
      }

      const { element: cardEl, cleanup } = await renderOffscreenExportElement({
        render: (container, onReady) => {
          const root = createRoot(container);
          root.render(
            <ExportCard
              title={title || 'Untitled'}
              content={content}
              author={resolvedAuthor}
              onReady={onReady}
            />
          );
          return () => root.unmount();
        },
      });
      cleanupRenderedElement = cleanup;

      const rect = cardEl.getBoundingClientRect();

      logExport(`[${exportId}] Capturing`, {
        size: `${rect.width}x${rect.height}`,
        dpr: window.devicePixelRatio || 1,
      });

      const result = await exportElementToPng(cardEl, `${title || 'article'}.png`);

      logExport(`[${exportId}] Done`, {
        mode: result.mode,
        files: result.files,
        outputPixels: `${result.outputWidth}x${result.outputHeight}`,
        sizeKB: (result.totalSize / 1024).toFixed(0),
      });
      toast.success(
        result.files > 1 ? t('exportSplitSuccess', { count: result.files }) : t('exportSuccess')
      );
    } catch (e) {
      logExportError(`[${exportId}] Failed`, e);
      toast.error(t('exportFailed'));
    } finally {
      cleanupRenderedElement?.();
      cleanupOffscreenContainers();
      setExporting(false);
    }
  };

  return { exporting, handleExportImage };
}
