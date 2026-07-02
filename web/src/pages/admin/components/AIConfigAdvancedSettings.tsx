import { Button } from '@/components/ui/button';
import Divider from '@/components/ui/divider';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { post } from '@/utils/api';
import {
  ChevronDown,
  Database,
  Pause,
  Play,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SystemConfig } from '../types';

type AiConfig = NonNullable<SystemConfig['ai']>;

interface AIConfigAdvancedSettingsProps {
  config: AiConfig;
  vectorStatus: any;
  jobStats?: Record<string, number>;
  busyAction: string | null;
  updateConfig: (next: Partial<AiConfig>) => void;
  runAction: (key: string, action: () => Promise<any>, success: string) => Promise<void>;
}

export default function AIConfigAdvancedSettings({
  config,
  vectorStatus,
  jobStats,
  busyAction,
  updateConfig,
  runAction,
}: AIConfigAdvancedSettingsProps) {
  const { t } = useTranslation('translation', { keyPrefix: 'pages.admin' });

  return (
    <details className="group rounded-md border">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="size-4" />
          <span className="font-medium">{t('ai.advancedSettings')}</span>
        </div>
        <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
      </summary>
      <Divider />
      <div className="space-y-5 p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="space-y-2">
            <Label>{t('ai.chunkSize')}</Label>
            <Input
              type="number"
              min="500"
              value={config.indexing?.chunkSize || 1800}
              onChange={(event) =>
                updateConfig({
                  indexing: {
                    ...config.indexing,
                    chunkSize: Number(event.target.value) || 1800,
                  },
                })
              }
            />
          </div>
          <div className="space-y-2">
            <Label>{t('ai.chunkOverlap')}</Label>
            <Input
              type="number"
              min="0"
              value={config.indexing?.chunkOverlap || 200}
              onChange={(event) =>
                updateConfig({
                  indexing: {
                    ...config.indexing,
                    chunkOverlap: Number(event.target.value) || 0,
                  },
                })
              }
            />
          </div>
          <div className="space-y-2">
            <Label>{t('ai.batchSize')}</Label>
            <Input
              type="number"
              min="1"
              max="20"
              value={config.indexing?.batchSize || 5}
              onChange={(event) =>
                updateConfig({
                  indexing: {
                    ...config.indexing,
                    batchSize: Number(event.target.value) || 5,
                  },
                })
              }
            />
          </div>
          <div className="space-y-2">
            <Label>{t('ai.maxRetries')}</Label>
            <Input
              type="number"
              min="1"
              value={config.indexing?.maxRetries || 3}
              onChange={(event) =>
                updateConfig({
                  indexing: {
                    ...config.indexing,
                    maxRetries: Number(event.target.value) || 3,
                  },
                })
              }
            />
          </div>
        </div>

        <div className="grid gap-2 text-sm md:grid-cols-2">
          <p className="text-muted-foreground">
            {t('ai.pgvectorStatus', {
              available: vectorStatus?.available ? t('ai.yes') : t('ai.no'),
              installed: vectorStatus?.installed ? t('ai.yes') : t('ai.no'),
              index: vectorStatus?.indexName || t('ai.none'),
            })}
          </p>
          <p className="text-muted-foreground">
            {t('ai.jobStats', {
              pending: jobStats?.pending || 0,
              running: jobStats?.running || 0,
              succeeded: jobStats?.succeeded || 0,
              failed: jobStats?.failed || 0,
            })}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              runAction('enable-vector', () => post('/ai/vector/enable'), t('ai.pgvectorReady'))
            }
            disabled={busyAction === 'enable-vector'}
          >
            <Database className="size-4" />
            {t('ai.enablePgvector')}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              runAction('backfill', () => post('/ai/index/backfill'), t('ai.backfillQueued'))
            }
            disabled={busyAction === 'backfill'}
          >
            <RefreshCw className="size-4" />
            {t('ai.backfill')}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => runAction('process', () => post('/ai/index/process'), t('ai.processed'))}
            disabled={busyAction === 'process'}
          >
            <Play className="size-4" />
            {t('ai.process')}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              runAction(
                config.indexing?.paused ? 'resume' : 'pause',
                () => post(config.indexing?.paused ? '/ai/index/resume' : '/ai/index/pause'),
                config.indexing?.paused ? t('ai.resumed') : t('ai.paused')
              )
            }
          >
            {config.indexing?.paused ? <Play className="size-4" /> : <Pause className="size-4" />}
            {config.indexing?.paused ? t('ai.resume') : t('ai.pause')}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              runAction('retry', () => post('/ai/index/retry-failed'), t('ai.failedJobsRequeued'))
            }
          >
            <RefreshCw className="size-4" />
            {t('ai.retryFailed')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => runAction('clear', () => post('/ai/index/clear'), t('ai.indexCleared'))}
          >
            <Trash2 className="size-4" />
            {t('ai.clearIndex')}
          </Button>
        </div>
      </div>
    </details>
  );
}
