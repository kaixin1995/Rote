import ExportCard from '@/components/article/ExportCard';
import { snapdom } from '@zumer/snapdom';
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

async function toDataURL(url: string): Promise<string> {
  const res = await fetch(url);
  const blob = await res.blob();
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

export function useArticleExport() {
  const [exporting, setExporting] = useState(false);
  const { t } = useTranslation('translation', { keyPrefix: 'article.actions' });

  const handleExportImage = async ({ title, content, author }: UseArticleExportOptions) => {
    if (!content || exporting) return;
    setExporting(true);
    try {
      let resolvedAuthor = author;
      if (author?.avatar) {
        try {
          resolvedAuthor = { ...author, avatar: await toDataURL(author.avatar) };
        } catch {
          resolvedAuthor = { ...author, avatar: '/DefaultAvatar.svg' };
        }
      }

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

      const cardEl = container.firstElementChild;
      if (!cardEl) throw new Error('Export card not rendered');

      const result = await snapdom(cardEl, { scale: 6, filename: title || 'article' });
      await result.download({ format: 'png' });

      root.unmount();
      document.body.removeChild(container);
      toast.success(t('exportSuccess'));
    } catch (e) {
      console.error('Export failed:', e);
      toast.error(t('exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  return { exporting, handleExportImage };
}
