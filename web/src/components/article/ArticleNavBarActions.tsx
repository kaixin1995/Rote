import { useArticleExport } from '@/hooks/useArticleExport';
import { downloadMarkdown } from '@/utils/downloadMarkdown';
import { formatBytes } from '@/utils/main';
import { Download, FileText, Image as ImageIcon, Loader, TextInitialIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

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

export default function ArticleNavBarActions({ content, title, author }: ArticleNavBarActionsProps) {
  const { t } = useTranslation('translation', { keyPrefix: 'article.editor' });
  const { t: tActions } = useTranslation('translation', { keyPrefix: 'article.actions' });
  const { exporting, handleExportImage } = useArticleExport();

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
          <TextInitialIcon className="size-3 group-hover:hidden" />
          {exporting ? (
            <Loader className="size-3 animate-spin group-hover:block" />
          ) : (
            <ImageIcon className="hidden size-3 group-hover:block" />
          )}
          {t('wordsCount', {
            defaultValue: '{{count}} Words',
            count: content.length,
          })}
        </div>
        <div
          className="group hidden cursor-pointer items-center gap-2 px-2 lg:flex"
          onClick={(e) => {
            e.stopPropagation();
            downloadMarkdown(content, title);
          }}
          title={t('download', { defaultValue: 'Download Markdown' })}
        >
          <FileText className="size-3 group-hover:hidden" />
          <Download className="hidden size-3 group-hover:block" />
          {formatBytes(new Blob([content]).size)}
        </div>
      </div>
    </>
  );
}
