import type { AiSemanticResult } from '@/utils/aiApi';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

interface Author {
  nickname?: string;
  avatar?: string;
  username?: string;
}

interface UseAiAnswerExportOptions {
  content: string;
  sources?: AiSemanticResult[];
  sourceTitle: string;
  author?: Author;
}

function getAiAnswerFilename(content: string) {
  const firstLine = content
    .split('\n')
    .find((line) => line.trim())
    ?.replace(/^#+\s*/, '')
    .trim();
  const name = firstLine || 'ai-memory-answer';
  return name.replace(/[\\/:*?"<>|]/g, '').slice(0, 40) || 'ai-memory-answer';
}

export function useAiAnswerExport() {
  const [exporting, setExporting] = useState(false);
  const { t } = useTranslation('translation', { keyPrefix: 'pages.aiMemory.actions' });

  const handleExport = async (
    { content, sources, sourceTitle, author }: UseAiAnswerExportOptions,
    format: 'image' | 'pdf'
  ) => {
    const exportId = Math.random().toString(36).slice(2, 8);

    if (!content || exporting) return;
    setExporting(true);
    let cleanupOffscreenContainers: () => void = () => {};
    let logExportError: (step: string, error?: unknown) => void = () => {};
    let cleanupRenderedElement: (() => void) | undefined;

    try {
      const [{ createRoot }, exportImage, { default: AiAnswerExportCard }] = await Promise.all([
        import('react-dom/client'),
        import('@/utils/exportImage'),
        import('@/components/ai/AiAnswerExportCard'),
      ]);
      const {
        cleanupOffscreenContainers: cleanup,
        exportElementToPng,
        logExport,
        logExportError: logError,
        renderOffscreenExportElement,
        toDataURL,
      } = exportImage;
      cleanupOffscreenContainers = cleanup;
      logExportError = logError;

      logExport(`[${exportId}] Start AI answer ${format}`, {
        contentLength: content.length,
        sources: sources?.length || 0,
      });

      let resolvedAuthor = author;
      if (author?.avatar) {
        try {
          resolvedAuthor = { ...author, avatar: await toDataURL(author.avatar) };
        } catch {
          resolvedAuthor = { ...author, avatar: '/DefaultAvatar.svg' };
        }
      }

      const {
        container,
        element: cardEl,
        cleanup: cleanupElement,
      } = await renderOffscreenExportElement({
        className: 'ai-answer-export-container',
        render: (container, onReady) => {
          const root = createRoot(container);
          root.render(
            <AiAnswerExportCard
              content={content}
              sources={sources}
              sourceTitle={sourceTitle}
              author={resolvedAuthor}
              onReady={onReady}
            />
          );
          return () => root.unmount();
        },
      });
      cleanupRenderedElement = cleanupElement;

      if (format === 'pdf') {
        container.classList.add('print-container');
        // Give browser a moment to apply the print class styles before opening dialog
        await new Promise((resolve) => setTimeout(resolve, 50));
        window.print();
        container.classList.remove('print-container');
        logExport(`[${exportId}] Done AI answer PDF`);
        toast.success(t('exportSuccess'));
      } else {
        const result = await exportElementToPng(cardEl, `${getAiAnswerFilename(content)}.png`);
        logExport(`[${exportId}] Done AI answer PNG`, {
          mode: result.mode,
          files: result.files,
          outputPixels: `${result.outputWidth}x${result.outputHeight}`,
          sizeKB: (result.totalSize / 1024).toFixed(0),
        });
        toast.success(
          result.files > 1 ? t('exportSplitSuccess', { count: result.files }) : t('exportSuccess')
        );
      }
    } catch (error) {
      logExportError(`[${exportId}] Failed AI answer ${format}`, error);
      toast.error(t('exportFailed'));
    } finally {
      cleanupRenderedElement?.();
      cleanupOffscreenContainers();
      setExporting(false);
    }
  };

  const handleExportImage = (options: UseAiAnswerExportOptions) => handleExport(options, 'image');
  const handleExportPdf = (options: UseAiAnswerExportOptions) => handleExport(options, 'pdf');

  return { exporting, handleExportImage, handleExportPdf };
}
