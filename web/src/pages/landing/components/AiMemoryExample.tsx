import AiStreamingMarkdown from '@/components/ai/AiStreamingMarkdown';
import { Button } from '@/components/ui/button';
import {
  ArrowDown,
  Brain,
  Link as LinkIcon,
  SlidersHorizontal,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import type { CSSProperties, RefObject, WheelEvent } from 'react';

type ThinkingItem = {
  title: string;
  content: string;
};

type AiMemoryExampleLabels = {
  user: string;
  scopeTitle: string;
  debugTitle: string;
  thinkingExpand: string;
  sourceTitle: string;
  backToBottom: string;
};

type AiMemoryExampleProps = {
  exampleRef: RefObject<HTMLDivElement | null>;
  featureListHeight: number;
  labels: AiMemoryExampleLabels;
  scope: string[];
  debugItems: string[];
  thinkingItems: ThinkingItem[];
  sources: string[];
  streamedAnswer: string;
  isStreaming: boolean;
  isAutoScrollPaused: boolean;
  onScroll: () => void;
  onWheel: (event: WheelEvent<HTMLDivElement>) => void;
  onReturnToBottom: () => void;
};

const fadeScrollStyle: CSSProperties = {
  WebkitMaskImage: 'linear-gradient(to right, black calc(100% - 24px), transparent 100%)',
  maskImage: 'linear-gradient(to right, black calc(100% - 24px), transparent 100%)',
  paddingRight: '24px',
};

export function AiMemoryExample({
  exampleRef,
  featureListHeight,
  labels,
  scope,
  debugItems,
  thinkingItems,
  sources,
  streamedAnswer,
  isStreaming,
  isAutoScrollPaused,
  onScroll,
  onWheel,
  onReturnToBottom,
}: AiMemoryExampleProps) {
  return (
    <div className="relative min-w-0 self-start">
      <div
        ref={exampleRef}
        className="noScrollBar bg-background max-h-[clamp(420px,70dvh,620px)] overflow-x-hidden overflow-y-auto border-x lg:h-(--ai-memory-example-height) lg:max-h-none"
        style={
          {
            '--ai-memory-example-height': `${featureListHeight}px`,
          } as CSSProperties
        }
        onScroll={onScroll}
        onWheel={onWheel}
      >
        <div className="divide-y-[0.5px]">
          <div className="px-4 py-4">
            <div className="mx-auto flex max-w-3xl flex-col gap-2 text-sm">
              <div className="wrap-break-word whitespace-pre-line">{labels.user}</div>
            </div>
          </div>

          <div className="bg-foreground/2 px-4 py-4">
            <div className="mx-auto flex max-w-3xl flex-col gap-3 text-sm">
              <ExampleTokenRow
                icon={SlidersHorizontal}
                title={labels.scopeTitle}
                items={scope}
                itemClassName="text-info bg-foreground/5 rounded px-1.5 py-0.5"
              />
              <ExampleTokenRow
                icon={Workflow}
                title={labels.debugTitle}
                items={debugItems}
                itemClassName="text-muted-foreground bg-foreground/5 rounded px-1.5 py-0.5"
              />

              <div className="space-y-2">
                {thinkingItems.map((item) => (
                  <div
                    key={item.title}
                    className="flex min-w-0 items-center gap-1.5 text-xs leading-5"
                  >
                    <span className="text-muted-foreground flex shrink-0 items-center gap-1 font-medium whitespace-nowrap select-none">
                      <Brain className="size-3 shrink-0" />
                      {item.title}:
                    </span>
                    <div
                      className="noScrollBar text-muted-foreground min-w-0 flex-1 overflow-x-auto whitespace-nowrap opacity-80"
                      style={fadeScrollStyle}
                    >
                      {item.content}
                    </div>
                    <span className="text-muted-foreground shrink-0 whitespace-nowrap opacity-70">
                      {labels.thinkingExpand}
                    </span>
                  </div>
                ))}
              </div>

              <div className="relative flex w-full items-center gap-1.5 text-xs">
                <span className="text-muted-foreground flex shrink-0 items-center gap-1 font-medium whitespace-nowrap select-none">
                  <LinkIcon className="size-3 shrink-0" />
                  {labels.sourceTitle}:
                </span>
                <div
                  className="noScrollBar flex flex-1 items-center gap-1.5 overflow-x-auto"
                  style={fadeScrollStyle}
                >
                  {sources.map((source, index) => (
                    <span
                      key={`${index}-${source}`}
                      className="hover:bg-foreground/5 hover:text-foreground inline-flex shrink-0 items-center gap-1 font-mono text-xs underline transition-colors"
                    >
                      <span>[{index + 1}]</span>
                      <span className="max-w-[120px] truncate">{source}</span>
                    </span>
                  ))}
                </div>
              </div>

              <AiStreamingMarkdown content={streamedAnswer} isStreaming={isStreaming} />
              <div className="h-6 shrink-0" />
            </div>
          </div>
        </div>
      </div>
      {isAutoScrollPaused && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="absolute bottom-6 left-1/2 z-20 size-8 -translate-x-1/2 rounded-full shadow-sm"
          onClick={onReturnToBottom}
          aria-label={labels.backToBottom}
          title={labels.backToBottom}
        >
          <ArrowDown className="size-4" />
        </Button>
      )}
    </div>
  );
}

function ExampleTokenRow({
  icon: Icon,
  title,
  items,
  itemClassName,
}: {
  icon: LucideIcon;
  title: string;
  items: string[];
  itemClassName: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-muted-foreground flex shrink-0 items-center gap-1 font-medium whitespace-nowrap select-none">
        <Icon className="size-3 shrink-0" />
        {title}:
      </span>
      {items.map((item) => (
        <span key={item} className={itemClassName}>
          {item}
        </span>
      ))}
    </div>
  );
}
