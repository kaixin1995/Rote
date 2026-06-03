import { AiSourceList } from '@/components/ai/AiSourceList';
import LoadingPlaceholder from '@/components/others/LoadingPlaceholder';
import { getRelatedNotes } from '@/utils/aiApi';
import { useAPIGet } from '@/utils/fetcher';
import { useTranslation } from 'react-i18next';

export function RelatedNotesBlock({ roteId, enabled }: { roteId?: string; enabled: boolean }) {
  const { t } = useTranslation('translation', { keyPrefix: 'components.relatedNotes' });

  const { data, isLoading, error } = useAPIGet(
    enabled && roteId ? { key: 'ai-related-rotes', roteId } : null,
    () =>
      getRelatedNotes({
        sourceType: 'rote',
        sourceId: roteId || '',
        sourceTypes: ['rote'],
        limit: 5,
      }),
    {
      revalidateOnFocus: false,
    }
  );

  if (!enabled) return null;

  if (isLoading) {
    return (
      <div className="border-b py-4">
        <LoadingPlaceholder className="py-4" size={5} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-info border-b px-4 py-6 text-center text-sm font-light">
        {t('unavailable')}
      </div>
    );
  }

  return (
    <AiSourceList
      className="border-b"
      sources={data || []}
      title={t('title')}
      emptyLabel={t('empty')}
      compact
    />
  );
}
