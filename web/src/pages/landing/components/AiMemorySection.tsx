import { Blend, Laugh, Search, SlidersHorizontal, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type WheelEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AiMemoryExample } from './AiMemoryExample';
import { AiMemoryFeatureList } from './AiMemoryFeatureList';

type AiMemoryFeature = {
  icon: LucideIcon;
  title: string;
  description: string;
};

export function AiMemorySection() {
  const { t } = useTranslation('translation', { keyPrefix: 'pages.landing' });
  const featureListRef = useRef<HTMLDivElement>(null);
  const exampleRef = useRef<HTMLDivElement>(null);
  const autoScrollPausedRef = useRef(false);
  const hasStartedStreamRef = useRef(false);
  const [streamedAnswer, setStreamedAnswer] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [shouldStartStream, setShouldStartStream] = useState(false);
  const [isAutoScrollPaused, setIsAutoScrollPaused] = useState(false);
  const [featureListHeight, setFeatureListHeight] = useState(620);

  const features: AiMemoryFeature[] = [
    {
      icon: Search,
      title: t('aiMemory.features.semantic.title'),
      description: t('aiMemory.features.semantic.description'),
    },
    {
      icon: Laugh,
      title: t('aiMemory.features.sources.title'),
      description: t('aiMemory.features.sources.description'),
    },
    {
      icon: Blend,
      title: t('aiMemory.features.agent.title'),
      description: t('aiMemory.features.agent.description'),
    },
    {
      icon: SlidersHorizontal,
      title: t('aiMemory.features.admin.title'),
      description: t('aiMemory.features.admin.description'),
    },
  ];
  const sources = t('aiMemory.example.sources', { returnObjects: true }) as string[];
  const answer = t('aiMemory.example.answer');
  const scope = t('aiMemory.example.scope.items', { returnObjects: true }) as string[];
  const debugItems = t('aiMemory.example.debug.items', { returnObjects: true }) as string[];
  const thinkingItems = [
    {
      title: t('aiMemory.example.thinking.route.title'),
      content: t('aiMemory.example.thinking.route.content'),
    },
    {
      title: t('aiMemory.example.thinking.evidence.title'),
      content: t('aiMemory.example.thinking.evidence.content'),
    },
  ];

  const scrollToExampleEnd = useCallback((behavior: ScrollBehavior = 'auto') => {
    const container = exampleRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior });
  }, []);

  const handleExampleScroll = useCallback(() => {
    const container = exampleRef.current;
    if (!container) return;
    const distanceToBottom = container.scrollHeight - container.clientHeight - container.scrollTop;
    const isPaused = distanceToBottom > 80;
    autoScrollPausedRef.current = isPaused;
    setIsAutoScrollPaused(isPaused);
  }, []);

  const returnExampleToBottom = useCallback(() => {
    autoScrollPausedRef.current = false;
    setIsAutoScrollPaused(false);
    scrollToExampleEnd('smooth');
  }, [scrollToExampleEnd]);

  const handleExampleWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    if (event.deltaY < 0) {
      autoScrollPausedRef.current = true;
      setIsAutoScrollPaused(true);
    }
  }, []);

  useEffect(() => {
    const featureList = featureListRef.current;
    if (!featureList) return;

    const updateFeatureListHeight = () => {
      const height = Math.ceil(featureList.getBoundingClientRect().height);
      if (height <= 0) return;
      setFeatureListHeight(height);
    };

    updateFeatureListHeight();

    const observer = new ResizeObserver(updateFeatureListHeight);
    observer.observe(featureList);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const container = exampleRef.current;
    if (!container) return;

    if (!('IntersectionObserver' in window)) {
      setShouldStartStream(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setShouldStartStream(true);
        observer.disconnect();
      },
      { threshold: 0.35 }
    );

    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!shouldStartStream || hasStartedStreamRef.current) return;
    hasStartedStreamRef.current = true;

    const shouldReduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (shouldReduceMotion) {
      setStreamedAnswer(answer);
      setIsStreaming(false);
      return;
    }

    let index = 0;
    let timeoutId: ReturnType<typeof setTimeout>;

    const streamNextChunk = () => {
      index = Math.min(answer.length, index + 2);
      setStreamedAnswer(answer.slice(0, index));
      requestAnimationFrame(() => {
        if (autoScrollPausedRef.current) return;
        scrollToExampleEnd();
      });

      if (index < answer.length) {
        timeoutId = setTimeout(streamNextChunk, 75);
        return;
      }

      setIsStreaming(false);
    };

    setStreamedAnswer('');
    setIsStreaming(true);
    timeoutId = setTimeout(streamNextChunk, 700);

    return () => clearTimeout(timeoutId);
  }, [answer, scrollToExampleEnd, shouldStartStream]);

  return (
    <div className="bg-background divide-y border-x sm:mx-4">
      <div className="space-y-2 divide-y-[0.5px] p-2">
        <p className="text-theme/20 pb-2 font-mono text-xs font-light uppercase">
          {t('aiMemory.tagline')}
        </p>
        <h2 className="text-3xl font-bold">{t('aiMemory.title')}</h2>
        <p className="text-info text-lg font-light">{t('aiMemory.subtitle')}</p>
      </div>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
        <AiMemoryFeatureList featureListRef={featureListRef} features={features} />
        <AiMemoryExample
          exampleRef={exampleRef}
          featureListHeight={featureListHeight}
          labels={{
            user: t('aiMemory.example.user'),
            scopeTitle: t('aiMemory.example.scope.title'),
            debugTitle: t('aiMemory.example.debug.title'),
            thinkingExpand: t('aiMemory.example.thinking.expand'),
            sourceTitle: t('aiMemory.example.sourceTitle'),
            backToBottom: t('aiMemory.example.backToBottom'),
          }}
          scope={scope}
          debugItems={debugItems}
          thinkingItems={thinkingItems}
          sources={sources}
          streamedAnswer={streamedAnswer}
          isStreaming={isStreaming}
          isAutoScrollPaused={isAutoScrollPaused}
          onScroll={handleExampleScroll}
          onWheel={handleExampleWheel}
          onReturnToBottom={returnExampleToBottom}
        />
      </div>
    </div>
  );
}
