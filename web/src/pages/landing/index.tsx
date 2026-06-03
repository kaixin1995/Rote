import v2ReleaseSvg from '@/assets/v2.0.svg?raw';
import AiStreamingMarkdown from '@/components/ai/AiStreamingMarkdown';
import { SlidingNumber } from '@/components/animate-ui/text/sliding-number';
import { AppStoreIcon } from '@/components/icons/Apple';
import LanguageSwitcher from '@/components/others/languageSwitcher';
import Logo from '@/components/others/logo';
import ProductHunt from '@/components/others/ProductHunt';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSiteStatus } from '@/hooks/useSiteStatus';
import { useSystemStatus } from '@/hooks/useSystemStatus';
import { useTypewriter } from '@/hooks/useTypewriter';
import { cn } from '@/utils/cn';
import { formatTimeAgo, isTokenValid } from '@/utils/main';
import {
  ArrowDown,
  ArrowUpRight,
  Blend,
  BookOpen,
  Brain,
  Code,
  Eye,
  GitFork,
  Github,
  Globe2,
  Laugh,
  Link as LinkIcon,
  MessageCircleQuestionIcon,
  Search,
  Server,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Split,
  Star,
  Workflow,
  Wrench,
} from 'lucide-react';
import {
  type CSSProperties,
  type WheelEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate } from 'react-router-dom';
import { toast } from 'sonner';
import useSWR from 'swr';

function Landing() {
  const { t } = useTranslation('translation', { keyPrefix: 'pages.landing' });
  const { isInitialized, isLoading, error } = useSystemStatus();
  const { data: siteStatus } = useSiteStatus();
  const toastShownRef = useRef(false);
  const aiMemoryFeatureListRef = useRef<HTMLDivElement>(null);
  const aiMemoryExampleRef = useRef<HTMLDivElement>(null);
  const aiMemoryAutoScrollPausedRef = useRef(false);
  const hasStartedAiMemoryStreamRef = useRef(false);
  const [streamedAiMemoryAnswer, setStreamedAiMemoryAnswer] = useState('');
  const [isAiMemoryAnswerStreaming, setIsAiMemoryAnswerStreaming] = useState(false);
  const [shouldStartAiMemoryStream, setShouldStartAiMemoryStream] = useState(false);
  const [isAiMemoryAutoScrollPaused, setIsAiMemoryAutoScrollPaused] = useState(false);
  const [aiMemoryFeatureListHeight, setAiMemoryFeatureListHeight] = useState(620);

  // 打字机效果文本数组
  const typewriterTexts = t('typewriterTexts', { returnObjects: true }) as string[];
  const typewriterText = useTypewriter({
    texts: typewriterTexts,
    typingSpeed: 100,
    deletingSpeed: 50,
    pauseTime: 2000,
  });

  const { data: roteGithubData, isLoading: isRoteGithubDataLoading } = useSWR(
    'https://api.github.com/repos/rabithua/rote',
    (url: string) => fetch(url).then((res) => res.json())
  );

  // 当需要跳转到 setup 页面时，显示 toast 提示
  useEffect(() => {
    if (!isLoading && (!isInitialized || error) && !toastShownRef.current) {
      toastShownRef.current = true;
      if (error) {
        toast.error(t('redirectingToSetup.error'));
      } else {
        toast.info(t('redirectingToSetup.notInitialized'));
      }
    }
  }, [isLoading, isInitialized, error, t]);

  // 根据最后推送时间获取颜色类
  const getTimeColor = (pushedAt: string) => {
    const now = new Date();
    const pushDate = new Date(pushedAt);
    const diffInDays = Math.floor((now.getTime() - pushDate.getTime()) / (1000 * 60 * 60 * 24));

    if (diffInDays <= 7) {
      return 'text-green-600'; // 一周内 - 绿色
    } else if (diffInDays <= 30) {
      return 'text-yellow-600'; // 一个月内 - 黄色
    } else if (diffInDays <= 365) {
      return 'text-orange-600'; // 一年内 - 橙色
    } else {
      return 'text-red-600'; // 超过一年 - 红色
    }
  };
  const dataRender = [
    {
      key: 'stargazers_count',
      icon: <Star className="size-4" />,
      title: t('star'),
    },
    {
      key: 'forks_count',
      icon: <GitFork className="size-4" />,
      title: t('fork'),
    },
    {
      key: 'open_issues_count',
      icon: <MessageCircleQuestionIcon className="size-4" />,
      title: t('issues'),
    },
    {
      key: 'watchers_count',
      icon: <Eye className="size-4" />,
      title: t('watch'),
    },
  ];

  const features = [
    {
      icon: BookOpen,
      title: t('coreFeatures.features.restraint.title'),
      description: t('coreFeatures.features.restraint.description'),
    },
    {
      icon: Sparkles,
      title: t('coreFeatures.features.simple.title'),
      description: t('coreFeatures.features.simple.description'),
    },
    {
      icon: Code,
      title: t('coreFeatures.features.openApi.title'),
      description: t('coreFeatures.features.openApi.description'),
    },
    {
      icon: Shield,
      title: t('coreFeatures.features.freedom.title'),
      description: t('coreFeatures.features.freedom.description'),
    },
  ];

  const aiMemoryFeatures = [
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
  const aiMemoryExampleSources = t('aiMemory.example.sources', { returnObjects: true }) as string[];
  const aiMemoryExampleAnswer = t('aiMemory.example.answer');
  const aiMemoryExampleScope = t('aiMemory.example.scope.items', {
    returnObjects: true,
  }) as string[];
  const aiMemoryExampleDebug = t('aiMemory.example.debug.items', {
    returnObjects: true,
  }) as string[];
  const aiMemoryExampleThinking = [
    {
      title: t('aiMemory.example.thinking.route.title'),
      content: t('aiMemory.example.thinking.route.content'),
    },
    {
      title: t('aiMemory.example.thinking.evidence.title'),
      content: t('aiMemory.example.thinking.evidence.content'),
    },
  ];

  const scrollToAiMemoryExampleEnd = useCallback((behavior: ScrollBehavior = 'auto') => {
    const container = aiMemoryExampleRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior });
  }, []);

  const handleAiMemoryExampleScroll = useCallback(() => {
    const container = aiMemoryExampleRef.current;
    if (!container) return;
    const distanceToBottom = container.scrollHeight - container.clientHeight - container.scrollTop;
    const isPaused = distanceToBottom > 80;
    aiMemoryAutoScrollPausedRef.current = isPaused;
    setIsAiMemoryAutoScrollPaused(isPaused);
  }, []);

  const returnAiMemoryExampleToBottom = useCallback(() => {
    aiMemoryAutoScrollPausedRef.current = false;
    setIsAiMemoryAutoScrollPaused(false);
    scrollToAiMemoryExampleEnd('smooth');
  }, [scrollToAiMemoryExampleEnd]);

  const handleAiMemoryExampleWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    if (event.deltaY < 0) {
      aiMemoryAutoScrollPausedRef.current = true;
      setIsAiMemoryAutoScrollPaused(true);
    }
  }, []);

  useEffect(() => {
    const featureList = aiMemoryFeatureListRef.current;
    if (!featureList) return;

    const updateFeatureListHeight = () => {
      const height = Math.ceil(featureList.getBoundingClientRect().height);
      if (height <= 0) return;
      setAiMemoryFeatureListHeight(height);
    };

    updateFeatureListHeight();

    const observer = new ResizeObserver(updateFeatureListHeight);
    observer.observe(featureList);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const container = aiMemoryExampleRef.current;
    if (!container) return;

    if (!('IntersectionObserver' in window)) {
      setShouldStartAiMemoryStream(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setShouldStartAiMemoryStream(true);
        observer.disconnect();
      },
      { threshold: 0.35 }
    );

    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!shouldStartAiMemoryStream || hasStartedAiMemoryStreamRef.current) return;
    hasStartedAiMemoryStreamRef.current = true;

    const shouldReduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (shouldReduceMotion) {
      setStreamedAiMemoryAnswer(aiMemoryExampleAnswer);
      setIsAiMemoryAnswerStreaming(false);
      return;
    }

    let index = 0;
    let timeoutId: ReturnType<typeof setTimeout>;

    const streamNextChunk = () => {
      index = Math.min(aiMemoryExampleAnswer.length, index + 2);
      setStreamedAiMemoryAnswer(aiMemoryExampleAnswer.slice(0, index));
      requestAnimationFrame(() => {
        if (aiMemoryAutoScrollPausedRef.current) return;
        scrollToAiMemoryExampleEnd();
      });

      if (index < aiMemoryExampleAnswer.length) {
        timeoutId = setTimeout(streamNextChunk, 75);
        return;
      }

      setIsAiMemoryAnswerStreaming(false);
    };

    setStreamedAiMemoryAnswer('');
    setIsAiMemoryAnswerStreaming(true);
    timeoutId = setTimeout(streamNextChunk, 700);

    return () => clearTimeout(timeoutId);
  }, [aiMemoryExampleAnswer, scrollToAiMemoryExampleEnd, shouldStartAiMemoryStream]);

  const andMoreFeatures = [
    {
      icon: Server,
      title: t('andMore.features.selfHosted.title'),
      description: t('andMore.features.selfHosted.description'),
    },
    {
      icon: Wrench,
      title: t('andMore.features.tools.title'),
      description: t('andMore.features.tools.description'),
    },
    {
      icon: Split,
      title: t('andMore.features.architecture.title'),
      description: t('andMore.features.architecture.description'),
    },
    {
      icon: AppStoreIcon,
      title: t('andMore.features.iosClient.title'),
      description: t('andMore.features.iosClient.description'),
    },
  ];

  const quickLinks = [
    {
      name: t('quickLinks.selfHosted'),
      href: '/doc/selfhosted',
      icon: <Server className="size-5 transition-transform" />,
      external: false,
    },
    {
      name: t('quickLinks.github'),
      href: 'https://github.com/Rabithua/Rote',
      icon: <Github className="size-5 transition-transform" />,
      external: true,
    },
    {
      name: t('quickLinks.explore'),
      href: '/explore',
      icon: <Globe2 className="size-5 transition-transform" />,
      external: false,
    },
    {
      name: t('quickLinks.rabithua'),
      href: 'https://rote.ink/rabithua',
      icon: (
        <img
          src="https://avatars.githubusercontent.com/u/34543831?v=4&size=64"
          alt="Rabithua"
          className="size-6 rounded-full border"
        />
      ),
      external: true,
    },
  ];

  // 如果未初始化或出现错误，都跳转到 setup 页面
  if (!isLoading && (!isInitialized || error)) {
    return <Navigate to="/setup" replace />;
  }

  return (
    <div className="bg-pattern min-h-dvh divide-y font-sans">
      {/* Logo and Title - 更优雅的层次 */}
      <div className="bg-background/90 sticky top-0 z-10 w-full px-6 py-4 backdrop-blur-md">
        <div className="flex w-full items-end gap-4">
          <div className="flex shrink-0 justify-center">
            <Logo className="h-6 w-auto opacity-90" color="#07C160" />
          </div>

          {/* 诗句 - 更小更低调 */}
          <div className="flex min-w-0 flex-1 gap-2">
            <span className="text-info truncate text-sm font-light tracking-wide" title={t('poem')}>
              {t('poem')}
            </span>
          </div>

          <LanguageSwitcher className="ml-auto shrink-0" />
        </div>
      </div>

      {/* Hero Section */}
      <div className="bg-background relative space-y-6 divide-y-[0.5px] overflow-hidden border-r border-l py-20 sm:mx-4">
        {/* Main heading - 更克制的设计 */}
        <div className="space-y-2 divide-y-[0.5px] px-2">
          <div className="space-y-3">
            <div
              className="text-foreground h-10 w-fit [&_svg]:block [&_svg]:h-full [&_svg]:w-auto"
              role="img"
              aria-label="Rote v2.0 AI is ready"
              dangerouslySetInnerHTML={{ __html: v2ReleaseSvg }}
            />
            <h1 className="text-foreground text-3xl leading-tight font-bold tracking-tight sm:text-4xl lg:text-5xl">
              {t('headingBefore')}
              <br className="block sm:hidden" />
              <span className="text-theme inline-block">
                {typewriterText}
                <span className="animate-pulse font-thin">|</span>
              </span>
              {t('headingAfter')}
            </h1>
          </div>

          {/* 副标题 - 更清晰的层次 */}
          <p className="text-info pb-3 text-xl leading-relaxed font-light">{t('subtitle')}</p>
        </div>

        {/* CTA Buttons - 更优雅的按钮设计 */}
        <div className="flex flex-row flex-wrap items-center gap-3 px-2 pb-4">
          <Button size="lg" asChild>
            <Link
              to={isTokenValid() ? '/home' : '/login'}
              className="text-background hover:text-background"
            >
              {isTokenValid() ? t('dashboard') : t('linksItems.0')}
            </Link>
          </Button>

          <Button
            variant="outline"
            asChild
            size="lg"
            className="border-muted-foreground/20 hover:bg-muted/50"
          >
            <Link target="_blank" rel="noopener noreferrer" to="https://demo.rote.ink/login">
              Demo
              <ArrowUpRight className="inline-block size-5" />
            </Link>
          </Button>

          <Link
            to="https://apps.apple.com/us/app/rote/id6755513897"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center"
          >
            <img
              src="/download-on-the-app-store.svg"
              alt="Download on the App Store"
              className="h-10"
            />
          </Link>

          <Button
            variant="outline"
            size="lg"
            asChild
            className="border-muted-foreground/20 hover:bg-muted/50"
          >
            <Link to="https://github.com/Rabithua/Rote" target="_blank">
              <Github className="size-4" />
              {t('linksItems.2')}
              <ArrowUpRight className="inline-block size-5" />
            </Link>
          </Button>

          <ProductHunt />
        </div>

        <div className="group absolute right-10 bottom-0 flex flex-col items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to="https://apps.apple.com/us/app/rote/id6755513897"
                target="_blank"
                rel="noopener noreferrer"
                className="relative h-10 translate-y-3 rotate-5 transition-all duration-300 group-hover:-translate-y-2 group-hover:scale-110"
              >
                {/* 亮色模式图片 */}
                <img
                  src="/ios_icon_compressed.png"
                  alt="hero"
                  className="z-1 h-10 drop-shadow-2xl drop-shadow-black/10 dark:hidden"
                />
                {/* 暗色模式图片 */}
                <img
                  src="/ios_icon_dark_compressed.png"
                  alt="hero"
                  className="z-1 hidden h-10 drop-shadow-2xl drop-shadow-black/10 dark:block"
                />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="left" sideOffset={8}>
              <div className="flex flex-col gap-1">
                <span>{t('iosAppTooltip.title')}</span>
                <Link
                  to="https://testflight.apple.com/join/WC3ETKwp"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-theme hover:text-theme/80 inline-flex items-center hover:underline"
                >
                  {t('iosAppTooltip.earlyAccess')}
                  <ArrowUpRight className="size-3" />
                </Link>
              </div>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Features Section */}
      <div className="bg-background divide-y border-x sm:mx-4">
        <div className="space-y-2 divide-y-[0.5px] p-2">
          <p className="text-theme/20 pb-2 font-mono text-xs font-light uppercase">
            {t('coreFeatures.tagline')}
          </p>
          <h2 className="text-3xl font-bold">{t('coreFeatures.title')}</h2>
          <p className="text-info text-lg font-light">{t('coreFeatures.subtitle')}</p>
        </div>

        <div className="gap-6 p-2 md:grid md:grid-cols-2">
          {features.map((feature, index) => (
            <div key={index}>
              <div className="hover:bg-accent/5 group flex flex-row items-start gap-6 py-8 transition-all duration-300">
                {/* Icon */}
                <div className="border-theme bg-theme/10 group-hover:bg-theme/20 flex size-16 shrink-0 items-center justify-center rounded-md border-[0.5px] border-dashed transition-all duration-300">
                  <feature.icon className="text-theme size-8" />
                </div>

                {/* Content */}
                <div className="flex-1">
                  <h3 className="mb-3 text-xl font-semibold">{feature.title}</h3>
                  <p className="text-info leading-relaxed font-light">{feature.description}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-background divide-y border-x sm:mx-4">
        <div className="space-y-2 divide-y-[0.5px] p-2">
          <p className="text-theme/20 pb-2 font-mono text-xs font-light uppercase">
            {t('aiMemory.tagline')}
          </p>
          <h2 className="text-3xl font-bold">{t('aiMemory.title')}</h2>
          <p className="text-info text-lg font-light">{t('aiMemory.subtitle')}</p>
        </div>

        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
          <div ref={aiMemoryFeatureListRef} className="divide-y-[0.5px] self-start px-2">
            {aiMemoryFeatures.map((feature, index) => (
              <div
                key={index}
                className="hover:bg-accent/5 group flex flex-row items-start gap-5 py-6 transition-all duration-300"
              >
                <div className="border-theme bg-theme/10 group-hover:bg-theme/20 flex size-12 shrink-0 items-center justify-center rounded-md border-[0.5px] border-dashed transition-all duration-300">
                  <feature.icon className="text-theme size-6" />
                </div>

                <div className="min-w-0 flex-1">
                  <h3 className="mb-2 text-lg font-semibold">{feature.title}</h3>
                  <p className="text-info leading-relaxed font-light">{feature.description}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="relative min-w-0 self-start">
            <div
              ref={aiMemoryExampleRef}
              className="noScrollBar bg-background max-h-[clamp(420px,70dvh,620px)] overflow-x-hidden overflow-y-auto border-x lg:h-(--ai-memory-example-height) lg:max-h-none"
              style={
                {
                  '--ai-memory-example-height': `${aiMemoryFeatureListHeight}px`,
                } as CSSProperties
              }
              onScroll={handleAiMemoryExampleScroll}
              onWheel={handleAiMemoryExampleWheel}
            >
              <div className="divide-y-[0.5px]">
                <div className="px-4 py-4">
                  <div className="mx-auto flex max-w-3xl flex-col gap-2 text-sm">
                    <div className="wrap-break-word whitespace-pre-line">
                      {t('aiMemory.example.user')}
                    </div>
                  </div>
                </div>

                <div className="bg-foreground/2 px-4 py-4">
                  <div className="mx-auto flex max-w-3xl flex-col gap-3 text-sm">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="text-muted-foreground flex shrink-0 items-center gap-1 font-medium whitespace-nowrap select-none">
                        <SlidersHorizontal className="size-3 shrink-0" />
                        {t('aiMemory.example.scope.title')}:
                      </span>
                      {aiMemoryExampleScope.map((item) => (
                        <span
                          key={item}
                          className="text-info bg-foreground/5 rounded px-1.5 py-0.5"
                        >
                          {item}
                        </span>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="text-muted-foreground flex shrink-0 items-center gap-1 font-medium whitespace-nowrap select-none">
                        <Workflow className="size-3 shrink-0" />
                        {t('aiMemory.example.debug.title')}:
                      </span>
                      {aiMemoryExampleDebug.map((item) => (
                        <span
                          key={item}
                          className="text-muted-foreground bg-foreground/5 rounded px-1.5 py-0.5"
                        >
                          {item}
                        </span>
                      ))}
                    </div>

                    <div className="space-y-2">
                      {aiMemoryExampleThinking.map((item) => (
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
                            style={{
                              WebkitMaskImage:
                                'linear-gradient(to right, black calc(100% - 24px), transparent 100%)',
                              maskImage:
                                'linear-gradient(to right, black calc(100% - 24px), transparent 100%)',
                              paddingRight: '24px',
                            }}
                          >
                            {item.content}
                          </div>
                          <span className="text-muted-foreground shrink-0 whitespace-nowrap opacity-70">
                            {t('aiMemory.example.thinking.expand')}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="relative flex w-full items-center gap-1.5 text-xs">
                      <span className="text-muted-foreground flex shrink-0 items-center gap-1 font-medium whitespace-nowrap select-none">
                        <LinkIcon className="size-3 shrink-0" />
                        {t('aiMemory.example.sourceTitle')}:
                      </span>
                      <div
                        className="noScrollBar flex flex-1 items-center gap-1.5 overflow-x-auto"
                        style={{
                          WebkitMaskImage:
                            'linear-gradient(to right, black calc(100% - 24px), transparent 100%)',
                          maskImage:
                            'linear-gradient(to right, black calc(100% - 24px), transparent 100%)',
                          paddingRight: '24px',
                        }}
                      >
                        {aiMemoryExampleSources.map((source, index) => (
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

                    <AiStreamingMarkdown
                      content={streamedAiMemoryAnswer}
                      isStreaming={isAiMemoryAnswerStreaming}
                    />
                    <div className="h-6 shrink-0" />
                  </div>
                </div>
              </div>
            </div>
            {isAiMemoryAutoScrollPaused && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="absolute bottom-6 left-1/2 z-20 size-8 -translate-x-1/2 rounded-full shadow-sm"
                onClick={returnAiMemoryExampleToBottom}
                aria-label={t('aiMemory.example.backToBottom')}
                title={t('aiMemory.example.backToBottom')}
              >
                <ArrowDown className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="bg-background divide-y border-x sm:mx-4">
        <div className="space-y-2 divide-y-[0.5px] p-2">
          <p className="text-theme/20 pb-2 font-mono text-xs font-light uppercase">
            {t('andMore.tagline')}
          </p>
          <h2 className="text-3xl font-bold">{t('andMore.title')}</h2>
          <p className="text-info text-lg font-light">{t('andMore.subtitle')}</p>
        </div>

        <div className="gap-6 p-2 md:grid md:grid-cols-2">
          {andMoreFeatures.map((feature, index) => (
            <div key={index}>
              <div className="hover:bg-accent/5 group flex flex-row items-start gap-6 py-8 transition-all duration-300">
                {/* Icon */}
                <div className="border-theme bg-theme/10 group-hover:bg-theme/20 flex size-16 shrink-0 items-center justify-center rounded-md border-[0.5px] border-dashed transition-all duration-300">
                  <feature.icon className="text-theme size-8" />
                </div>

                {/* Content */}
                <div className="flex-1">
                  <h3 className="mb-3 text-xl font-semibold">{feature.title}</h3>
                  <p className="text-info leading-relaxed font-light">{feature.description}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-background divide-y border-x sm:mx-4">
        <div className="space-y-2 divide-y-[0.5px] p-2">
          <p className="text-theme/20 pb-2 font-mono text-xs font-light uppercase">
            {t('construction.tagline')}
          </p>
          <h2 className="text-3xl font-bold">{t('construction.title')}</h2>
          <p className="text-info text-lg font-light">{t('construction.subtitle')}</p>
        </div>
        {isRoteGithubDataLoading ? (
          <div className="flex flex-col gap-2 p-2">
            {/* 骨架屏 - 模拟 GitHub 数据展示 */}
            <div className="flex gap-2">
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Skeleton className="h-4 w-4" />
                  <div className="flex items-center gap-1">
                    <Skeleton className="h-4 w-8" />
                    <Skeleton className="h-4 w-12" />
                  </div>
                </div>
              ))}
            </div>
            <Skeleton className="h-3 w-32" />
          </div>
        ) : (
          <div className="flex flex-col gap-2 divide-y-[0.5px] p-2">
            <div className="flex flex-wrap gap-2 pb-2 text-sm font-thin">
              {dataRender.map((item) => (
                <div key={item.key} className="flex items-center gap-2">
                  {item.icon}
                  <div className="flex items-center gap-1 text-sm">
                    <SlidingNumber number={roteGithubData[item.key]} /> {item.title}
                  </div>
                </div>
              ))}
            </div>
            <div className={`text-xs opacity-40 ${getTimeColor(roteGithubData.pushed_at)}`}>
              {t('lastPushTime')}
              {formatTimeAgo(roteGithubData.pushed_at)}
            </div>
          </div>
        )}
      </div>

      {/* Quick Links Section */}
      <div className="bg-background/80 divide-y-[0.5px] p-2 backdrop:blur-xl sm:p-6">
        <div className="space-y-2 divide-y-[0.5px]">
          <p className="text-theme/20 pb-2 font-mono text-xs font-light uppercase">
            {t('exploreMore.tagline')}
          </p>
          <h3 className="text-3xl font-bold">{t('exploreMore.title')}</h3>
          <p className="text-info text-lg font-light">{t('exploreMore.subtitle')}</p>
        </div>

        <div className="flex flex-row flex-wrap items-center gap-4 py-8">
          {quickLinks.map((link) => (
            <div key={link.name} className="group">
              <Button variant={link.external ? 'outline' : 'default'} asChild>
                <Link
                  to={link.href}
                  target={link.external ? '_blank' : undefined}
                  rel={link.external ? 'noopener noreferrer' : undefined}
                  className={cn(
                    'flex items-center justify-center gap-3 py-3',
                    link.external
                      ? 'text-foreground hover:text-foreground'
                      : 'text-background hover:text-background'
                  )}
                >
                  {link.icon}
                  <span className="font-medium">{link.name}</span>
                  {link.external && <ArrowUpRight className="inline-block size-5" />}
                </Link>
              </Button>
            </div>
          ))}
        </div>

        {/* ICP Record Footer */}
        {siteStatus?.site?.icpRecord && (
          <div className="bg-background/60 border-muted/20 border-t py-4">
            <a
              href="https://beian.miit.gov.cn/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs"
            >
              {siteStatus.site.icpRecord}
            </a>
            <ArrowUpRight className="inline-block size-3" />
          </div>
        )}
      </div>
    </div>
  );
}

export default Landing;
