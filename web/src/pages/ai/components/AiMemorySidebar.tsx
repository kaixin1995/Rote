import { AiSourceList } from '@/components/ai/AiSourceList';
import { Button } from '@/components/ui/button';
import type { PersonalAiProviderConfig, PersonalAiSettings } from '@/state/localAi';
import type { AiSemanticResult, AiStatus } from '@/utils/aiApi';
import { ArrowDownLeft, ArrowUpRight, Loader, Settings2 } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import {
  buttonType,
  ghostButtonVariant,
  iconButtonSize,
  statusBlockClasses,
} from './aiPageClasses';

type SendMessage = (
  value: string,
  options?: {
    ignorePendingPlan?: boolean;
  }
) => Promise<void>;

type AiMemoryStatusBlockProps = {
  status?: AiStatus;
  isStatusLoading: boolean;
  isStatusValidating: boolean;
  onRefreshStatus: () => void;
  personalAi: PersonalAiSettings;
  activePersonalConfig: PersonalAiProviderConfig;
  isPersonalModelMode: boolean;
  personalAiReady: boolean;
  unavailableText: string;
  roteCount: number;
  vectorProgress: number;
  onOpenPersonalAiDialog: () => void;
};

function AiMemoryStatusBlock({
  status,
  isStatusLoading,
  isStatusValidating,
  onRefreshStatus,
  personalAi,
  activePersonalConfig,
  isPersonalModelMode,
  personalAiReady,
  unavailableText,
  roteCount,
  vectorProgress,
  onOpenPersonalAiDialog,
}: AiMemoryStatusBlockProps) {
  const { t } = useTranslation('translation', { keyPrefix: 'pages.aiMemory' });
  const statusText = (() => {
    if (isStatusLoading) return t('status.checking');
    if (isPersonalModelMode) return personalAiReady ? t('status.ready') : unavailableText;
    if (status?.available) return t('status.ready');
    return status?.chatAvailable ? t('status.chatReady') : unavailableText;
  })();
  const providerText =
    personalAi.mode === 'personal'
      ? t('model.personal')
      : status?.chatMode === 'local'
        ? t('model.local')
        : status?.chatMode === 'site'
          ? t('model.site')
          : t('model.disabled');
  const modelText = isPersonalModelMode
    ? activePersonalConfig.model || t('model.noModel')
    : status?.chatModel || t('model.noModel');

  return (
    <div className="px-4 py-2">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="text-md min-w-0 truncate">{t('status.title')}</div>
        <div className={statusBlockClasses.actions}>
          <div className={statusBlockClasses.statusText}>
            {isStatusLoading || isStatusValidating ? (
              <Loader className={statusBlockClasses.statusLoader} />
            ) : null}
            {!isStatusLoading && !status?.available ? (
              <button
                type={buttonType}
                className={statusBlockClasses.statusRefresh}
                onClick={onRefreshStatus}
              >
                {statusText}
              </button>
            ) : (
              <span className={statusBlockClasses.truncate}>{statusText}</span>
            )}
          </div>
          <Button
            type={buttonType}
            variant={ghostButtonVariant}
            size={iconButtonSize}
            className={statusBlockClasses.settingsButton}
            onClick={onOpenPersonalAiDialog}
            aria-label={t('personal.openSettings')}
            title={t('personal.openSettings')}
          >
            <Settings2 className={statusBlockClasses.settingsIcon} />
          </Button>
        </div>
      </div>
      <div className="mt-2 flex min-w-0 items-center justify-between gap-3 text-sm">
        <span className="text-info min-w-0 truncate font-light">{t('model.source')}</span>
        <span className="shrink-0 truncate text-right text-xs font-medium">{providerText}</span>
      </div>
      <div className="mt-1 flex min-w-0 items-center justify-between gap-3 text-sm">
        <span className="text-info min-w-0 truncate font-light">{t('model.model')}</span>
        <span className="shrink-0 truncate text-right font-mono text-xs">
          {isStatusLoading ? '-' : modelText}
        </span>
      </div>
      <div className="mt-2 flex min-w-0 items-center justify-between gap-3 text-sm">
        <span className="text-info min-w-0 truncate font-light">{t('memoryStats.roteCount')}</span>
        <span className="shrink-0 font-mono tabular-nums">
          {isStatusLoading ? '-' : roteCount.toLocaleString()}
        </span>
      </div>
      <div className="mt-1 flex min-w-0 items-center justify-between gap-3 text-sm">
        <span className="text-info min-w-0 truncate font-light">
          {t('memoryStats.vectorProgress')}
        </span>
        <span className="shrink-0 font-mono tabular-nums">
          {isStatusLoading
            ? '-'
            : t('memoryStats.vectorProgressValue', { percent: vectorProgress })}
        </span>
      </div>
      <div className="text-info mt-2 line-clamp-3 text-xs font-light">
        {personalAi.mode === 'personal' ? t('personal.personalPrivacy') : t('privacy.description')}
      </div>
    </div>
  );
}

export function AiMemorySidebar({
  status,
  isStatusLoading,
  isStatusValidating,
  onRefreshStatus,
  personalAi,
  activePersonalConfig,
  isPersonalModelMode,
  personalAiReady,
  unavailableText,
  roteCount,
  vectorProgress,
  onOpenPersonalAiDialog,
  quickPrompts,
  isPromptsExpanded,
  setIsPromptsExpanded,
  isSending,
  unavailable,
  sendMessage,
  visibleSources,
}: AiMemoryStatusBlockProps & {
  quickPrompts: string[];
  isPromptsExpanded: boolean;
  setIsPromptsExpanded: Dispatch<SetStateAction<boolean>>;
  isSending: boolean;
  unavailable: boolean;
  sendMessage: SendMessage;
  visibleSources: AiSemanticResult[];
}) {
  const { t } = useTranslation('translation', { keyPrefix: 'pages.aiMemory' });
  const prompts = isPromptsExpanded ? quickPrompts : quickPrompts.slice(0, 4);

  return (
    <div className="flex w-full flex-col divide-y">
      <AiMemoryStatusBlock
        status={status}
        isStatusLoading={isStatusLoading}
        isStatusValidating={isStatusValidating}
        onRefreshStatus={onRefreshStatus}
        personalAi={personalAi}
        activePersonalConfig={activePersonalConfig}
        isPersonalModelMode={isPersonalModelMode}
        personalAiReady={personalAiReady}
        unavailableText={unavailableText}
        roteCount={roteCount}
        vectorProgress={vectorProgress}
        onOpenPersonalAiDialog={onOpenPersonalAiDialog}
      />
      <div className="divide-border/50 flex flex-col divide-y">
        <div className="px-4 py-2">
          <div className="text-md">{t('quick.title')}</div>
          <div className="text-info text-xs font-light">{t('empty.desc')}</div>
        </div>
        <div className="grid w-4/5 gap-2 px-4 py-2">
          {prompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              className="hover:text-info min-w-0 cursor-pointer text-left text-sm duration-200 hover:opacity-60 disabled:pointer-events-none disabled:opacity-40"
              disabled={isSending || unavailable}
              onClick={() => void sendMessage(prompt, { ignorePendingPlan: true })}
            >
              <span className="line-clamp-2 min-w-0">{prompt}</span>
            </button>
          ))}
          {!isPromptsExpanded && quickPrompts.length > 4 && (
            <button
              type="button"
              className="text-info hover:text-foreground flex cursor-pointer items-center gap-2 text-sm duration-200 hover:opacity-60"
              onClick={() => setIsPromptsExpanded(true)}
            >
              <ArrowDownLeft className="size-4 shrink-0" />
              <span className="min-w-0 truncate">{t('quick.expand')}</span>
            </button>
          )}
          {isPromptsExpanded && quickPrompts.length > 4 && (
            <button
              type="button"
              className="text-info hover:text-foreground flex cursor-pointer items-center gap-2 text-sm duration-200 hover:opacity-60"
              onClick={() => setIsPromptsExpanded(false)}
            >
              <ArrowUpRight className="size-4 shrink-0" />
              <span className="min-w-0 truncate">{t('quick.collapse')}</span>
            </button>
          )}
        </div>
      </div>
      <div className="divide-border/50 flex flex-col divide-y">
        <div className="px-4 py-2">
          <div className="text-md">{t('sources.title')}</div>
          {visibleSources.length === 0 && (
            <div className="text-info text-xs font-light">{t('sources.empty')}</div>
          )}
        </div>
        <AiSourceList sources={visibleSources} emptyLabel={t('sources.empty')} />
      </div>
    </div>
  );
}
