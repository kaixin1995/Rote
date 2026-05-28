import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import Divider from '@/components/ui/divider';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { get, post, put } from '@/utils/api';
import {
  Activity,
  Brain,
  ChevronDown,
  Database,
  Pause,
  Play,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import useSWR from 'swr';
import type { AiProviderConfig, AiProviderPreset, SystemConfig } from '../types';

const DEFAULT_AI_CONFIG: NonNullable<SystemConfig['ai']> = {
  enabled: false,
  vectorEnabled: false,
  autoIndexEnabled: false,
  publicExploreVectorEnabled: false,
  chat: {
    providerId: 'openai',
    apiFormat: 'openai_compatible',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    apiKey: '',
  },
  embedding: {
    providerId: 'openai',
    apiFormat: 'openai_compatible',
    baseUrl: 'https://api.openai.com/v1',
    model: 'text-embedding-3-small',
    dimensions: 1536,
    apiKey: '',
  },
  indexing: {
    chunkSize: 1800,
    chunkOverlap: 200,
    batchSize: 5,
    maxRetries: 3,
    paused: false,
  },
};

interface AIConfigTabProps {
  aiConfig: SystemConfig['ai'] | undefined;
  setAiConfig: (config: SystemConfig['ai'] | undefined) => void;
  isSaving: boolean;
  setIsSaving: (saving: boolean) => void;
  onMutate: () => void;
}

function mergeAiConfig(config?: SystemConfig['ai']): NonNullable<SystemConfig['ai']> {
  const chat = { ...DEFAULT_AI_CONFIG.chat, ...(config?.chat || {}) } as AiProviderConfig;
  const embedding = {
    ...DEFAULT_AI_CONFIG.embedding,
    ...(config?.embedding || {}),
  } as NonNullable<SystemConfig['ai']>['embedding'];

  return {
    ...DEFAULT_AI_CONFIG,
    ...(config || {}),
    chat,
    embedding,
    indexing: { ...DEFAULT_AI_CONFIG.indexing, ...(config?.indexing || {}) },
  };
}

function StatusPill({ active, text }: { active: boolean; text: string }) {
  return (
    <span
      className={`inline-flex h-6 items-center rounded-full px-2 text-xs font-medium ${
        active
          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
          : 'bg-muted text-muted-foreground'
      }`}
    >
      {text}
    </span>
  );
}

function MetricBlock({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-muted/20 rounded-md border px-3 py-2">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 truncate text-sm font-medium">{value}</p>
    </div>
  );
}

export default function AIConfigTab({
  aiConfig,
  setAiConfig,
  isSaving,
  setIsSaving,
  onMutate,
}: AIConfigTabProps) {
  const { t } = useTranslation('translation', { keyPrefix: 'pages.admin' });
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const config = useMemo(() => mergeAiConfig(aiConfig), [aiConfig]);

  const { data: providers = [] } = useSWR<AiProviderPreset[]>('/ai/providers', async () => {
    const res = await get('/ai/providers');
    return res.data as AiProviderPreset[];
  });
  const { data: vectorStatus, mutate: mutateVectorStatus } = useSWR<any>(
    '/ai/vector/status',
    async () => {
      const res = await get('/ai/vector/status');
      return res.data;
    }
  );
  const { data: jobStats, mutate: mutateJobStats } = useSWR<Record<string, number>>(
    '/ai/index/stats',
    async () => {
      const res = await get('/ai/index/stats');
      return res.data;
    }
  );

  const updateConfig = (next: Partial<NonNullable<SystemConfig['ai']>>) => {
    setAiConfig(mergeAiConfig({ ...config, ...next }));
  };

  const updateProvider = (
    target: 'chat' | 'embedding',
    next: Partial<AiProviderConfig & { dimensions?: number }>
  ) => {
    updateConfig({
      [target]: {
        ...(config[target] as any),
        ...next,
      },
    });
  };

  const applyPreset = (target: 'chat' | 'embedding', providerId: string) => {
    const preset = providers.find((item) => item.id === providerId);
    if (!preset) return;
    const model =
      target === 'chat'
        ? preset.chatModels[0] || config.chat?.model || ''
        : preset.embeddingModels[0] || config.embedding?.model || '';
    updateProvider(target, {
      providerId,
      baseUrl: preset.baseUrl,
      model,
      apiKey: '',
    });
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await put('/admin/settings', {
        group: 'ai',
        config,
      });
      toast.success(t('saveSuccess'));
      onMutate();
    } catch (error: any) {
      const errorMessage =
        error?.response?.data?.message ||
        error?.message ||
        error?.response?.data?.error ||
        'Unknown error';
      toast.error(t('saveFailed', { error: errorMessage }));
    } finally {
      setIsSaving(false);
    }
  };

  const runAction = async (key: string, action: () => Promise<any>, success: string) => {
    setBusyAction(key);
    try {
      const res = await action();
      toast.success(res?.message || success);
      await Promise.all([mutateVectorStatus(), mutateJobStats(), onMutate()]);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || error?.message || 'Unknown error');
    } finally {
      setBusyAction(null);
    }
  };

  const renderSwitchRow = (
    key: 'enabled' | 'vectorEnabled' | 'autoIndexEnabled' | 'publicExploreVectorEnabled',
    label: string,
    description: string
  ) => (
    <div className="flex min-h-16 items-center justify-between gap-4 rounded-md border px-4 py-3">
      <div className="min-w-0 space-y-1">
        <Label>{label}</Label>
        <p className="text-muted-foreground text-xs">{description}</p>
      </div>
      <Switch
        checked={Boolean(config[key])}
        onCheckedChange={(checked) => updateConfig({ [key]: checked } as any)}
      />
    </div>
  );

  const renderProviderForm = (target: 'chat' | 'embedding') => {
    const provider = target === 'chat' ? config.chat : config.embedding;
    const capability = target === 'chat' ? 'chat' : 'embedding';
    const availableProviders = providers.filter((item) => item.capabilities.includes(capability));

    return (
      <section className="rounded-md border p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {target === 'chat' ? <Brain className="size-4" /> : <Database className="size-4" />}
            <h3 className="font-medium">
              {target === 'chat' ? t('ai.chatTitle') : t('ai.embeddingTitle')}
            </h3>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busyAction === `test-${target}`}
            onClick={() =>
              runAction(
                `test-${target}`,
                () => post('/ai/test', { target, config }),
                t('ai.testSuccess')
              )
            }
          >
            {busyAction === `test-${target}` ? t('ai.testing') : t('ai.test')}
          </Button>
        </div>

        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label>{t(`ai.${target}Provider`)}</Label>
              <Select
                value={provider?.providerId || 'custom'}
                onValueChange={(value) => applyPreset(target, value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableProviders.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('ai.model')}</Label>
              <Input
                value={provider?.model || ''}
                onChange={(event) => updateProvider(target, { model: event.target.value })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t('ai.baseUrl')}</Label>
            <Input
              value={provider?.baseUrl || ''}
              onChange={(event) => updateProvider(target, { baseUrl: event.target.value })}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label>{t('ai.apiKey')}</Label>
              <Input
                type="password"
                value={provider?.apiKey || ''}
                onChange={(event) => updateProvider(target, { apiKey: event.target.value })}
              />
            </div>
            {target === 'embedding' && (
              <div className="space-y-2">
                <Label>{t('ai.dimensions')}</Label>
                <Input
                  type="number"
                  min="1"
                  max="4000"
                  value={config.embedding?.dimensions || 1536}
                  onChange={(event) =>
                    updateProvider('embedding', { dimensions: Number(event.target.value) || 1536 })
                  }
                />
              </div>
            )}
          </div>
        </div>
      </section>
    );
  };

  return (
    <Card className="rounded-none border-none shadow-none">
      <CardHeader className="pb-0">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>{t('ai.title')}</CardTitle>
            <CardDescription>{t('ai.description')}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusPill
              active={config.enabled === true}
              text={config.enabled ? t('ai.enabledStatus') : t('ai.disabledStatus')}
            />
            <StatusPill
              active={vectorStatus?.installed === true}
              text={vectorStatus?.installed ? t('ai.vectorReady') : t('ai.vectorNotReady')}
            />
          </div>
        </div>
      </CardHeader>
      <Divider />

      <CardContent className="space-y-6">
        <section className="grid gap-3 md:grid-cols-4">
          <MetricBlock label={t('ai.providerSummary')} value={config.chat?.providerId || '-'} />
          <MetricBlock
            label={t('ai.embeddingSummary')}
            value={config.embedding?.providerId || '-'}
          />
          <MetricBlock label={t('ai.pendingJobs')} value={jobStats?.pending || 0} />
          <MetricBlock label={t('ai.failedJobs')} value={jobStats?.failed || 0} />
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Activity className="size-4" />
            <h3 className="font-medium">{t('ai.basicSwitches')}</h3>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {renderSwitchRow('enabled', t('ai.enabled'), t('ai.enabledDesc'))}
            {renderSwitchRow('vectorEnabled', t('ai.vectorEnabled'), t('ai.vectorEnabledDesc'))}
            {renderSwitchRow(
              'autoIndexEnabled',
              t('ai.autoIndexEnabled'),
              t('ai.autoIndexEnabledDesc')
            )}
            {renderSwitchRow(
              'publicExploreVectorEnabled',
              t('ai.publicExploreVectorEnabled'),
              t('ai.publicExploreVectorEnabledDesc')
            )}
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="font-medium">{t('ai.modelProviders')}</h3>
          <div className="grid gap-4 xl:grid-cols-2">
            {renderProviderForm('chat')}
            {renderProviderForm('embedding')}
          </div>
        </section>

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
                onClick={() =>
                  runAction('process', () => post('/ai/index/process'), t('ai.processed'))
                }
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
                {config.indexing?.paused ? (
                  <Play className="size-4" />
                ) : (
                  <Pause className="size-4" />
                )}
                {config.indexing?.paused ? t('ai.resume') : t('ai.pause')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  runAction(
                    'retry',
                    () => post('/ai/index/retry-failed'),
                    t('ai.failedJobsRequeued')
                  )
                }
              >
                <RefreshCw className="size-4" />
                {t('ai.retryFailed')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() =>
                  runAction('clear', () => post('/ai/index/clear'), t('ai.indexCleared'))
                }
              >
                <Trash2 className="size-4" />
                {t('ai.clearIndex')}
              </Button>
            </div>
          </div>
        </details>

        <Button onClick={handleSave} disabled={isSaving} className="w-full">
          {isSaving ? t('saving') : t('save')}
        </Button>
      </CardContent>
    </Card>
  );
}
