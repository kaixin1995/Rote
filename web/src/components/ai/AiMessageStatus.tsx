import type { AiMemoryMessage } from '@/state/aiChat';
import { Brain, Check, Loader, SlidersHorizontal, Workflow } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export function AiStatusTitle({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <span className="text-muted-foreground flex shrink-0 items-center gap-1 font-medium whitespace-nowrap select-none">
      {icon}
      {children}
    </span>
  );
}

export function ScopeSummary({ message, title }: { message: AiMemoryMessage; title: string }) {
  const { t } = useTranslation('translation', { keyPrefix: 'pages.aiMemory' });
  const summary = message.plan?.summary || [];

  if (summary.length > 0) {
    return (
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <AiStatusTitle icon={<SlidersHorizontal className="size-3 shrink-0" />}>
          {title}:
        </AiStatusTitle>
        {summary.map((item) => (
          <span key={item} className="text-info bg-foreground/5 rounded px-1.5 py-0.5">
            {item}
          </span>
        ))}
      </div>
    );
  }

  if (message.isStreaming && message.plan) {
    return (
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <Loader className="size-3 animate-spin" />
        <span className="text-muted-foreground animate-pulse font-medium">
          {message.plan.query
            ? `${t('messages.searching')}: ${message.plan.query}`
            : t('messages.searching')}
        </span>
      </div>
    );
  }

  return null;
}

export function AgentTimeline({ message, title }: { message: AiMemoryMessage; title: string }) {
  const items = message.timeline || [];
  if (items.length === 0) return null;

  const visibleItems = items.slice(-5);
  return (
    <div className="space-y-0.5 text-xs leading-5">
      <div className="flex items-center gap-1.5">
        <AiStatusTitle icon={<Workflow className="size-3 shrink-0" />}>{title}:</AiStatusTitle>
      </div>
      <div className="space-y-0.5">
        {visibleItems.map((item) => (
          <div key={item.id} className="text-muted-foreground flex min-w-0 items-center gap-1.5">
            {item.status === 'done' ? (
              <Check className="size-3 shrink-0" />
            ) : (
              <Loader className="size-3 shrink-0 animate-spin" />
            )}
            <span className="min-w-0 truncate">{item.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

type ThinkingPhase = 'planning' | 'answer';

export function ThinkingPendingLine({ title }: { title: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs leading-5">
      <AiStatusTitle icon={<Brain className="size-3 shrink-0 animate-pulse" />}>
        {title}
      </AiStatusTitle>
      <span className="text-muted-foreground animate-pulse">...</span>
    </div>
  );
}

export function ThinkingTraceEntry({
  phase,
  text,
  title,
  isExpanded,
  isStreaming,
  onToggle,
}: {
  phase: ThinkingPhase;
  text: string;
  title: string;
  isExpanded: boolean;
  isStreaming: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation('translation', { keyPrefix: 'pages.aiMemory' });
  const lineRef = useRef<HTMLDivElement>(null);
  const inlineText = useMemo(() => text.replace(/\s+/g, ' ').trim(), [text]);

  useEffect(() => {
    if (isExpanded) return;
    const line = lineRef.current;
    if (!line) return;
    line.scrollLeft = line.scrollWidth;
  }, [inlineText, isExpanded]);

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-1.5 text-xs leading-5">
        <AiStatusTitle
          icon={<Brain className={`size-3 shrink-0 ${isStreaming ? 'animate-pulse' : ''}`} />}
        >
          {title}
          {!isExpanded && t('thinkingTrace.separator')}
        </AiStatusTitle>
        {!isExpanded && (
          <div
            ref={lineRef}
            className="noScrollBar text-muted-foreground min-w-0 flex-1 overflow-x-auto whitespace-nowrap opacity-80"
            style={{
              WebkitMaskImage:
                'linear-gradient(to right, black calc(100% - 24px), transparent 100%)',
              maskImage: 'linear-gradient(to right, black calc(100% - 24px), transparent 100%)',
              paddingRight: '24px',
            }}
          >
            {inlineText}
          </div>
        )}
        {isExpanded && <div className="min-w-0 flex-1" />}
        {!isStreaming && (
          <button
            type="button"
            aria-expanded={isExpanded}
            aria-controls={`thinking-trace-${phase}`}
            className="text-muted-foreground hover:text-foreground shrink-0 whitespace-nowrap opacity-70 transition-colors"
            onClick={onToggle}
          >
            {isExpanded ? t('thinkingTrace.collapse') : t('thinkingTrace.expand')}
          </button>
        )}
      </div>
      {!isStreaming && isExpanded && (
        <div
          id={`thinking-trace-${phase}`}
          className="text-muted-foreground mt-1 max-h-36 overflow-y-auto text-xs leading-5 whitespace-pre-wrap"
        >
          {text}
        </div>
      )}
    </div>
  );
}

export function ThinkingTrace({ message }: { message: AiMemoryMessage }) {
  const { t } = useTranslation('translation', { keyPrefix: 'pages.aiMemory' });
  const [expandedPhases, setExpandedPhases] = useState<Record<ThinkingPhase, boolean>>({
    planning: false,
    answer: false,
  });
  const entries = [
    { phase: 'planning' as const, text: message.thinking?.planning || '' },
    { phase: 'answer' as const, text: message.thinking?.answer || '' },
  ].filter((entry) => entry.text.trim().length > 0);
  const hasContent = message.content.trim().length > 0;
  const isStreaming = message.isStreaming || false;
  const hasAnswerThinking = entries.some((entry) => entry.phase === 'answer');
  const shouldShowPendingAnswer =
    isStreaming && !hasContent && !hasAnswerThinking && (entries.length === 0 || !!message.plan);

  if (entries.length === 0) {
    if (shouldShowPendingAnswer) {
      return (
        <div className="space-y-1">
          <ThinkingPendingLine title={t('thinkingTrace.answer')} />
        </div>
      );
    }

    return null;
  }

  return (
    <div className="space-y-1">
      {entries.map((entry) => {
        const title =
          entry.phase === 'planning' ? t('thinkingTrace.planning') : t('thinkingTrace.answer');
        const isExpanded = expandedPhases[entry.phase] || false;

        return (
          <ThinkingTraceEntry
            key={entry.phase}
            phase={entry.phase}
            text={entry.text}
            title={title}
            isExpanded={isExpanded}
            isStreaming={isStreaming}
            onToggle={() =>
              setExpandedPhases((current) => ({
                ...current,
                [entry.phase]: !current[entry.phase],
              }))
            }
          />
        );
      })}
      {shouldShowPendingAnswer && <ThinkingPendingLine title={t('thinkingTrace.answer')} />}
    </div>
  );
}
