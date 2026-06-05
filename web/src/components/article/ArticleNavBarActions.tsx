import { useArticleExport } from '@/hooks/useArticleExport';
import { downloadMarkdown } from '@/utils/downloadMarkdown';
import { formatBytes } from '@/utils/main';
import { Download, FileText, Image as ImageIcon, Loader, TextInitialIcon } from 'lucide-react';
import type { MouseEvent, PointerEvent } from 'react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

const PDF_LONG_PRESS_MS = 800;

interface Author {
  nickname?: string;
  avatar?: string;
  username?: string;
}

interface ArticleNavBarActionsProps {
  content: string;
  title: string;
  author?: Author;
}

export default function ArticleNavBarActions({
  content,
  title,
  author,
}: ArticleNavBarActionsProps) {
  const { t } = useTranslation('translation', { keyPrefix: 'article.editor' });
  const { t: tActions } = useTranslation('translation', { keyPrefix: 'article.actions' });
  const { exporting, handleExportImage, handleExportPdf } = useArticleExport();
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPressRef = useRef(false);

  useEffect(
    () => () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
      }
    },
    []
  );

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const startPdfLongPress = (e: PointerEvent<HTMLDivElement>) => {
    if (exporting) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    didLongPressRef.current = false;
    clearLongPressTimer();
    longPressTimerRef.current = setTimeout(() => {
      didLongPressRef.current = true;
      longPressTimerRef.current = null;
      if (navigator.vibrate) {
        try {
          navigator.vibrate(20);
        } catch {}
      }
      void handleExportPdf({ title, content, author });
    }, PDF_LONG_PRESS_MS);
  };

  const handleMarkdownClick = (e: MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();

    if (didLongPressRef.current) {
      e.preventDefault();
      didLongPressRef.current = false;
      return;
    }

    downloadMarkdown(content, title);
  };

  return (
    <>
      <div className="flex-1" />
      <div className="flex items-center font-mono text-xs font-normal lg:divide-x">
        <div
          className={`group flex cursor-pointer items-center gap-2 px-2 ${exporting ? 'opacity-50' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            handleExportImage({ title, content, author });
          }}
          title={tActions('exportImage')}
        >
          {exporting ? (
            <Loader className="size-3 animate-spin" />
          ) : (
            <>
              <TextInitialIcon className="size-3 group-hover:hidden" />
              <ImageIcon className="hidden size-3 group-hover:block" />
            </>
          )}
          {exporting
            ? tActions('exporting', { defaultValue: 'Exporting...' })
            : t('wordsCount', {
                defaultValue: '{{count}} Words',
                count: content.length,
              })}
        </div>
        <div
          className={`group hidden cursor-pointer items-center gap-2 px-2 select-none lg:flex ${
            exporting ? 'opacity-50' : ''
          }`}
          onClick={handleMarkdownClick}
          onPointerDown={startPdfLongPress}
          onPointerUp={clearLongPressTimer}
          onPointerCancel={clearLongPressTimer}
          onPointerLeave={clearLongPressTimer}
          onContextMenu={(e) => e.preventDefault()}
          style={{
            WebkitUserSelect: 'none',
            userSelect: 'none',
            WebkitTouchCallout: 'none',
          }}
          title={`${t('download', { defaultValue: 'Download Markdown' })} / ${tActions(
            'longPressExportPdf',
            { defaultValue: 'Long press to export PDF' }
          )}`}
        >
          <FileText className="size-3 group-hover:hidden" />
          <Download className="hidden size-3 group-hover:block" />
          {formatBytes(new Blob([content]).size)}
        </div>
      </div>
    </>
  );
}
