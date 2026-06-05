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

  const resolveAuthor = async (author?: Author) => {
    if (!author?.avatar) return author;

    try {
      return { ...author, avatar: await toDataURL(author.avatar) };
    } catch {
      return { ...author, avatar: '/DefaultAvatar.svg' };
    }
  };

  const renderArticleExportCard = async ({
    title,
    content,
    author,
    className,
  }: UseArticleExportOptions & { className?: string }) => {
    const resolvedAuthor = await resolveAuthor(author);

    return renderOffscreenExportElement({
      className,
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
  };

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

      const { element: cardEl, cleanup } = await renderArticleExportCard({
        title,
        content,
        author,
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

  const handleExportPdf = async ({ title, content, author }: UseArticleExportOptions) => {
    const exportId = Math.random().toString(36).slice(2, 8);

    if (!content) return;
    if (exporting) return;

    setExporting(true);
    let cleanupRenderedElement: (() => void) | undefined;

    try {
      logExport(`[${exportId}] Start PDF`, {
        title: title?.slice(0, 40),
        contentLength: content.length,
      });

      const { cleanup } = await renderArticleExportCard({
        title,
        content,
        author,
        className: 'print-container article-print-container',
      });
      cleanupRenderedElement = cleanup;

      await new Promise((resolve) => setTimeout(resolve, 50));
      window.print();
      logExport(`[${exportId}] Done PDF`);
      toast.success(t('exportPdfSuccess'));
    } catch (e) {
      logExportError(`[${exportId}] Failed PDF`, e);
      toast.error(t('exportFailed'));
    } finally {
      cleanupRenderedElement?.();
      cleanupOffscreenContainers();
      setExporting(false);
    }
  };

  return { exporting, handleExportImage, handleExportPdf };
}
