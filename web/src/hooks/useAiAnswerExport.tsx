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

    try {
      const [{ createRoot }, exportImage, { default: AiAnswerExportCard }] = await Promise.all([
        import('react-dom/client'),
        import('@/utils/exportImage'),
        import('@/components/ai/AiAnswerExportCard'),
      ]);
      const {
        calculateScale,
        captureElementToPng,
        cleanupOffscreenContainers: cleanup,
        downloadBlob,
        logExport,
        logExportError: logError,
        waitForImagesToLoad,
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

      const container = document.createElement('div');
      container.className = 'ai-answer-export-container';
      container.style.cssText = 'position:absolute;left:-9999px;top:0;';
      document.body.appendChild(container);

      const root = createRoot(container);
      await new Promise<void>((resolve) => {
        root.render(
          <AiAnswerExportCard
            content={content}
            sources={sources}
            sourceTitle={sourceTitle}
            author={resolvedAuthor}
            onReady={resolve}
          />
        );
      });

      const cardEl = container.firstElementChild as HTMLElement;
      if (!cardEl) throw new Error('Card not rendered');

      await new Promise((resolve) => setTimeout(resolve, 100));
      await waitForImagesToLoad(cardEl);

      if (format === 'pdf') {
        container.classList.add('print-container');
        // Give browser a moment to apply the print class styles before opening dialog
        await new Promise((resolve) => setTimeout(resolve, 50));
        window.print();
        container.classList.remove('print-container');
        logExport(`[${exportId}] Done AI answer PDF`);
        toast.success(t('exportSuccess'));
      } else {
        const rect = cardEl.getBoundingClientRect();
        const scale = calculateScale(rect.width, rect.height);
        const blob = await captureElementToPng(cardEl, scale);
        downloadBlob(blob, `${getAiAnswerFilename(content)}.png`);
        logExport(`[${exportId}] Done AI answer PNG`, { sizeKB: (blob.size / 1024).toFixed(0) });
        toast.success(t('exportSuccess'));
      }
    } catch (error) {
      logExportError(`[${exportId}] Failed AI answer ${format}`, error);
      toast.error(t('exportFailed'));
    } finally {
      cleanupOffscreenContainers();
      setExporting(false);
    }
  };

  const handleExportImage = (options: UseAiAnswerExportOptions) => handleExport(options, 'image');
  const handleExportPdf = (options: UseAiAnswerExportOptions) => handleExport(options, 'pdf');

  return { exporting, handleExportImage, handleExportPdf };
}
