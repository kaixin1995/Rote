import NoteExportCard from '@/components/rote/NoteExportCard';
import type { Attachment } from '@/types/main';
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

interface UseNoteExportOptions {
  title?: string;
  content: string;
  noteId?: string;
  author?: Author;
  tags?: string[];
  attachments?: Attachment[];
  articleTitle?: string;
}

export function useNoteExport() {
  const [exporting, setExporting] = useState(false);
  const { t } = useTranslation('translation', { keyPrefix: 'components.roteItem' });

  const handleExportImage = async ({
    title,
    content,
    noteId,
    author,
    tags,
    attachments,
    articleTitle,
  }: UseNoteExportOptions) => {
    const exportId = Math.random().toString(36).slice(2, 8);

    if (!content && (!attachments || attachments.length === 0)) return;
    if (exporting) return;

    setExporting(true);
    let cleanupRenderedElement: (() => void) | undefined;

    try {
      logExport(`[${exportId}] Start`, {
        title: title?.slice(0, 40),
        contentLength: content.length,
        tags: tags?.length,
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
            <NoteExportCard
              title={title}
              content={content}
              noteId={noteId}
              tags={tags}
              attachments={attachments}
              articleTitle={articleTitle}
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

      const result = await exportElementToPng(cardEl, `${title || 'note'}.png`);

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
