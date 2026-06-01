import {
  AgentTimeline,
  AiStatusTitle,
  ScopeSummary,
  ThinkingTrace,
} from '@/components/ai/AiMessageStatus';
import { cleanSourceText, getAiSourcePath } from '@/components/ai/AiSourceList';
import { Button } from '@/components/ui/button';
import type { AiMemoryMessage } from '@/state/aiChat';
import { Link as LinkIcon, Loader, Save } from 'lucide-react';
import { Suspense, lazy } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

const AiStreamingMarkdown = lazy(() => import('@/components/ai/AiStreamingMarkdown'));

export function AiMessageItem({
  message,
  savingMessageId,
  saveAsNote,
}: {
  message: AiMemoryMessage;
  savingMessageId: string | null;
  saveAsNote: (message: AiMemoryMessage) => void;
}) {
  const { t } = useTranslation('translation', { keyPrefix: 'pages.aiMemory' });

  return (
    <div className={`px-4 py-4 ${message.role === 'assistant' ? 'bg-foreground/2' : ''}`}>
      <div className="mx-auto flex max-w-3xl flex-col gap-2 text-sm">
        {message.role === 'assistant' && (
          <ScopeSummary message={message} title={t('scope.title')} />
        )}
        {message.role === 'assistant' && (
          <AgentTimeline message={message} title={t('timeline.title')} />
        )}
        {message.role === 'assistant' && <ThinkingTrace message={message} />}
        {message.role === 'assistant' && (message.sources?.length || 0) > 0 && (
          <div className="relative flex w-full items-center gap-1.5 text-xs">
            <AiStatusTitle icon={<LinkIcon className="size-3 shrink-0" />}>
              {t('sources.inlineTitle')}:
            </AiStatusTitle>
            <div
              className="noScrollBar flex flex-1 items-center gap-1.5 overflow-x-auto"
              style={{
                WebkitMaskImage:
                  'linear-gradient(to right, black calc(100% - 24px), transparent 100%)',
                maskImage: 'linear-gradient(to right, black calc(100% - 24px), transparent 100%)',
                paddingRight: '24px',
              }}
            >
              {message.sources?.map((source, index) => {
                const cleanText = cleanSourceText(source.text);
                const titleText =
                  source.metadata?.title ||
                  cleanText.slice(0, 30).replace(/\s+/g, ' ').trim() ||
                  `[${index + 1}]`;
                const path = getAiSourcePath(source);
                return (
                  <Link
                    key={`${source.sourceType}-${source.sourceId}`}
                    to={path}
                    title={titleText}
                    className="hover:bg-foreground/5 hover:text-foreground inline-flex shrink-0 items-center gap-1 font-mono text-xs underline transition-colors"
                  >
                    <span>[{index + 1}]</span>
                    <span className="max-w-[120px] truncate">{titleText}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
        {message.role === 'assistant' && !message.error ? (
          message.content ? (
            <Suspense
              fallback={
                <div className="leading-7 wrap-break-word whitespace-pre-line">
                  {message.content}
                </div>
              }
            >
              <AiStreamingMarkdown
                content={message.content}
                isStreaming={message.isStreaming}
                sources={message.sources}
              />
            </Suspense>
          ) : (
            <div className="text-info flex items-center gap-2">
              <Loader className="size-4 animate-spin" />
              {!message.plan
                ? t('messages.thinking')
                : !(message.sources && message.sources.length > 0)
                  ? t('messages.searching')
                  : t('messages.reading')}
            </div>
          )
        ) : (
          <div
            className={`wrap-break-word whitespace-pre-line ${
              message.error ? 'text-destructive' : ''
            }`}
          >
            {message.content}
          </div>
        )}
        {!message.error && message.metrics && !message.isStreaming && (
          <div className="text-muted-foreground flex flex-wrap items-center gap-2 font-mono text-[10px]">
            {message.metrics.planTime && (
              <span>Plan: {(message.metrics.planTime / 1000).toFixed(2)}s</span>
            )}
            {message.metrics.sourcesTime && (
              <span>
                Sources:{' '}
                {((message.metrics.sourcesTime - (message.metrics.planTime || 0)) / 1000).toFixed(
                  2
                )}
                s
              </span>
            )}
            {message.metrics.firstTokenTime && (
              <span>
                First Token:{' '}
                {(
                  (message.metrics.firstTokenTime -
                    (message.metrics.sourcesTime || message.metrics.planTime || 0)) /
                  1000
                ).toFixed(2)}
                s
              </span>
            )}
            {message.metrics.totalTime && (
              <span>Total: {(message.metrics.totalTime / 1000).toFixed(2)}s</span>
            )}
            {message.metrics.usage && <span>Tokens: {message.metrics.usage.total_tokens}</span>}
          </div>
        )}
        {message.role === 'assistant' && !message.isStreaming && !message.error && (
          <div className="mt-3 hidden flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-xs"
              disabled={message.saved || savingMessageId === message.id}
              onClick={() => saveAsNote(message)}
            >
              {savingMessageId === message.id ? (
                <Loader className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              {message.saved ? t('saved') : t('saveAsNote')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
