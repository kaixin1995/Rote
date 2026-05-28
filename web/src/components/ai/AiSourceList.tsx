import type { AiSemanticResult } from '@/utils/aiApi';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

function getSourcePath(source: AiSemanticResult) {
  return source.sourceType === 'article'
    ? `/article/${source.sourceId}`
    : `/rote/${source.sourceId}`;
}

export function cleanSourceText(text: string): string {
  return text.replace(/^(Title:[^\n]*\n)?(Tags:[^\n]*\n)?/i, '').trim();
}

function getSourcePreview(source: AiSemanticResult) {
  return cleanSourceText(source.text).replace(/\s+/g, ' ');
}

function getSimilarityPercent(source: AiSemanticResult) {
  return Math.max(0, Math.min(100, Math.round(source.similarity * 100)));
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
  const { t } = useTranslation('translation', { keyPrefix: 'components.aiSourceList' });
  const visibleSources = useMemo(() => sources || [], [sources]);

  return (
    <div className={className}>
      {title && <div className="px-4 py-3 text-sm font-semibold">{title}</div>}
      {visibleSources.length === 0 ? (
        <div className="text-info px-4 py-6 text-center text-sm font-light">
          {emptyLabel || t('empty')}
        </div>
      ) : (
        <div className="divide-y">
          {visibleSources.map((source, index) => {
            const titleText = source.metadata?.title || getSourcePreview(source) || t('untitled');
            return (
              <Link
                key={`${source.sourceType}-${source.sourceId}`}
                to={getSourcePath(source)}
                className="hover:bg-foreground/3 block px-4 py-3 duration-200"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-info flex items-center gap-2 text-xs font-medium">
                      <span className="font-mono">[{index + 1}]</span>
                      <span className="font-medium">
                        {source.sourceType === 'article' ? t('article') : t('rote')}
                      </span>
                      <span className="ml-auto font-mono">{getSimilarityPercent(source)}%</span>
                    </div>
                    <div className="mt-1 line-clamp-1 text-sm">{titleText}</div>
                    {!compact && (
                      <div className="text-info mt-1 line-clamp-2 text-xs font-light">
                        {getSourcePreview(source)}
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
