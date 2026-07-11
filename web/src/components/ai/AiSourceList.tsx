import type { AiSemanticResult } from '@/utils/aiApi';
import { type CSSProperties, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

const sourceTextStyle: CSSProperties = {
  overflowWrap: 'anywhere',
  wordBreak: 'break-all',
};

function getSourcePath(source: AiSemanticResult) {
  return source.sourceType === 'article'
    ? `/article/${source.sourceId}`
    : `/rote/${source.sourceId}`;
}

export function cleanSourceText(text: string): string {
  return text.replace(/^(Title:[^\n]*\n)?(Tags:[^\n]*\n)?/i, '').trim();
}

function getSourcePreview(source: AiSemanticResult) {
  return (source.preview || cleanSourceText(source.text || '')).replace(/\s+/g, ' ');
}

function getSimilarityPercent(source: AiSemanticResult) {
  return Math.max(0, Math.min(100, Math.round(source.similarity * 100)));
}

function formatSourceDate(value: unknown, locale: string): string | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function getSourceDateValue(source: AiSemanticResult): unknown {
  const dateField = source.metadata?.retrievalDateField === 'updatedAt' ? 'updatedAt' : 'createdAt';
  return source.metadata?.[dateField];
}

export function AiSourceList({
  sources,
  title,
  emptyLabel,
  className = '',
  compact = true,
}: {
  sources?: AiSemanticResult[];
  title?: string;
  emptyLabel?: string;
  className?: string;
  compact?: boolean;
}) {
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'components.aiSourceList' });
  const visibleSources = useMemo(() => sources || [], [sources]);

  return (
    <div className={`min-w-0 overflow-hidden ${className}`}>
      {title && <div className="min-w-0 truncate px-4 py-3 text-sm font-semibold">{title}</div>}
      {visibleSources.length === 0 ? (
        <div className="text-info px-4 py-6 text-center text-sm font-light">
          {emptyLabel || t('empty')}
        </div>
      ) : (
        <div className="min-w-0 divide-y overflow-hidden">
          {visibleSources.map((source, index) => {
            const titleText = source.metadata?.title || getSourcePreview(source) || t('untitled');
            const previewText = getSourcePreview(source);
            return (
              <Link
                key={`${source.sourceType}-${source.sourceId}`}
                to={getSourcePath(source)}
                className="hover:bg-foreground/3 block max-w-full min-w-0 overflow-hidden px-4 py-3 duration-200"
              >
                <div className="flex max-w-full min-w-0 items-start gap-3 overflow-hidden">
                  <div className="max-w-full min-w-0 flex-1 overflow-hidden">
                    <div className="text-info flex min-w-0 items-center gap-2 text-xs font-medium">
                      <span className="shrink-0 font-mono">[{index + 1}]</span>
                      <span className="min-w-0 truncate font-medium">
                        {source.sourceType === 'article' ? t('article') : t('rote')}
                      </span>
                      <span className="ml-auto shrink-0 font-mono">
                        {source.retrievalMode === 'recent'
                          ? formatSourceDate(getSourceDateValue(source), i18n.language) || '-'
                          : `${getSimilarityPercent(source)}%`}
                      </span>
                    </div>
                    <div
                      className="mt-1 line-clamp-2 max-w-full min-w-0 overflow-hidden text-sm leading-6 whitespace-normal"
                      style={sourceTextStyle}
                    >
                      {titleText}
                    </div>
                    {!compact && (
                      <div
                        className="text-info mt-1 line-clamp-2 max-w-full min-w-0 overflow-hidden text-xs leading-5 font-light whitespace-normal"
                        style={sourceTextStyle}
                      >
                        {previewText}
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function getAiSourcePath(source: AiSemanticResult) {
  return getSourcePath(source);
}

export function getAiSourceSimilarityPercent(source: AiSemanticResult) {
  return getSimilarityPercent(source);
}
