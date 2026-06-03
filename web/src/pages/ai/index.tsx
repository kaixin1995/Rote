import { AiMessageItem } from '@/components/ai/AiMessageItem';
import { AiSourceList } from '@/components/ai/AiSourceList';
import NavBar from '@/components/layout/navBar';
import { SoftBottom } from '@/components/others/SoftBottom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import ContainerWithSideBar from '@/layout/ContainerWithSideBar';
import {
  aiChatMessagesAtom,
  aiRunStateAtom,
  getCurrentAiAssistantSources,
  sanitizeAiChatMessages,
} from '@/state/aiChat';
import { getAiStatus, type AiAgentPhase, type AiAgentToolProgressStatus } from '@/utils/aiApi';
import {
  clearAiRun,
  isAiRunActive,
  startAiRun,
  syncAiRunStateFromMessages,
} from '@/state/aiRunManager';
import { useAPIGet } from '@/utils/fetcher';
import { useAtom } from 'jotai';
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowUpRight,
  BrainCircuit,
  BrainCog,
  Loader,
  Send,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

function AiMemoryPage() {
  const { t } = useTranslation('translation', { keyPrefix: 'pages.aiMemory' });
  const [messages, setMessages] = useAtom(aiChatMessagesAtom);
  const [runState] = useAtom(aiRunStateAtom);
  const [input, setInput] = useState('');
  const [isPromptsExpanded, setIsPromptsExpanded] = useState(false);
  const [isAutoScrollPaused, setIsAutoScrollPaused] = useState(false);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const isSending = runState.isSending;

  const {
    data: status,
    isLoading: isStatusLoading,
    isValidating: isStatusValidating,
    mutate: refreshStatus,
  } = useAPIGet('ai-status', getAiStatus, {
    revalidateOnFocus: false,
  });

  const quickPrompts = useMemo(
    () => [
      t('quick.theme'),
      t('quick.mbti'),
      t('quick.flags'),
      t('quick.timelineMonth'),
      t('quick.focus'),
      t('quick.mood'),
      t('quick.stress'),
    ],
    [t]
  );

  const visibleSources = useMemo(() => getCurrentAiAssistantSources(messages), [messages]);
  const pendingPlan = useMemo(() => {
    const lastMessage = messages[messages.length - 1];
    return lastMessage?.role === 'assistant' && lastMessage.pendingPlan
      ? lastMessage.pendingPlan
      : null;
  }, [messages]);

  const unavailable =
    !isStatusLoading && (!status?.enabled || !status.vectorEnabled || !status.available);
  const unavailableText =
    status?.eligible === false ? t('status.unverified') : t('status.unavailable');
  const canSend = !isSending && !unavailable && input.trim().length > 0;
  const memoryStats = status?.memoryStats;
  const indexedRoteCount = memoryStats?.indexedRoteCount ?? 0;
  const roteCount = memoryStats?.roteCount ?? 0;
  const vectorProgress = roteCount > 0 ? Math.round((indexedRoteCount / roteCount) * 100) : 0;

  function getAgentPhaseLabel(phase: AiAgentPhase) {
    return t(`timeline.phases.${phase}`);
  }

  function getToolStartedLabel(toolName: string) {
    return t(`timeline.tools.${toolName}`, { defaultValue: toolName });
  }

  function getToolStatusLabel(status: AiAgentToolProgressStatus) {
    return t(`timeline.toolStatus.${status}`);
  }

  function getToolFinishedLabel(toolName: string) {
    return t(`timeline.toolDone.${toolName}`, {
      defaultValue: t('timeline.toolDone.default'),
    });
  }

  const scrollToMessageEnd = useCallback((behavior: ScrollBehavior = 'smooth') => {
    messageEndRef.current?.scrollIntoView({ block: 'end', behavior });
  }, []);

  const returnToBottom = useCallback(() => {
    setIsAutoScrollPaused(false);
    scrollToMessageEnd();
  }, [scrollToMessageEnd]);

  useEffect(() => {
    const handleScroll = () => {
      const scrollRoot = document.documentElement;
      const distanceToBottom = scrollRoot.scrollHeight - window.innerHeight - window.scrollY;
      setIsAutoScrollPaused(distanceToBottom > 160);
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
  }, []);

  useEffect(() => {
    // Keep the chat pinned while the user has not intentionally scrolled away.
    // eslint-disable-next-line react-you-might-not-need-an-effect/no-event-handler
    if (isAutoScrollPaused) return;
    scrollToMessageEnd('auto');
  }, [messages, isSending, scrollToMessageEnd]);

  useEffect(() => {
    if (isAiRunActive()) return;
    setMessages((prev) => sanitizeAiChatMessages(prev, t('messages.interrupted')));
  }, [setMessages, t]);

  useEffect(() => {
    // Keep the global run manager aligned with persisted chat history after reload.
    if (isSending) return;
    syncAiRunStateFromMessages(messages);
  }, [messages, isSending]);

  const clearChat = useCallback(() => {
    setIsAutoScrollPaused(false);
    clearAiRun();
  }, []);

  async function sendMessage(value: string, options: { ignorePendingPlan?: boolean } = {}) {
    const question = value.trim();
    if (!question) return;
    setInput('');
    setIsAutoScrollPaused(false);
    const started = await startAiRun({
      question,
      messages,
      pendingPlan: options.ignorePendingPlan ? null : pendingPlan,
      ignorePendingPlan: options.ignorePendingPlan,
      unavailable,
      labels: {
        phase: getAgentPhaseLabel,
        toolStarted: getToolStartedLabel,
        toolStatus: getToolStatusLabel,
        toolFinished: getToolFinishedLabel,
        sourcesFound: (count) => t('timeline.sourcesFound', { count }),
        askFailed: t('messages.askFailed'),
        fallbackNoAnswerWithSources: t('messages.fallbackNoAnswerWithSources'),
        fallbackNoAnswerNoSources: t('messages.fallbackNoAnswerNoSources'),
      },
    });
    if (!started) {
      setInput(question);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendMessage(input);
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(input);
    }
  }

  const StatusBlock = () => {
    const statusText = isStatusLoading
      ? t('status.checking')
      : status?.available
        ? t('status.ready')
        : unavailableText;

    return (
      <div className="px-4 py-2">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="text-md min-w-0 truncate">{t('status.title')}</div>
          <div className="text-info flex min-w-0 items-center justify-end gap-2 text-right text-xs font-light">
            {isStatusLoading || isStatusValidating ? (
              <Loader className="size-3 shrink-0 animate-spin" />
            ) : null}
            {!isStatusLoading && !status?.available ? (
              <button
                type="button"
                className="hover:text-foreground min-w-0 cursor-pointer truncate text-left duration-200 hover:opacity-60"
                onClick={() => refreshStatus()}
              >
                {statusText}
              </button>
            ) : (
              <span className="min-w-0 truncate">{statusText}</span>
            )}
          </div>
        </div>
        <div className="mt-2 flex min-w-0 items-center justify-between gap-3 text-sm">
          <span className="text-info min-w-0 truncate font-light">
            {t('memoryStats.roteCount')}
          </span>
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
          {t('privacy.description')}
        </div>
      </div>
    );
  };

  const SideBar = () => (
    <div className="flex w-full flex-col divide-y">
      <StatusBlock />
      <div className="divide-border/50 flex flex-col divide-y">
        <div className="px-4 py-2">
          <div className="text-md">{t('quick.title')}</div>
          <div className="text-info text-xs font-light">{t('empty.desc')}</div>
        </div>
        <div className="grid w-4/5 gap-2 px-4 py-2">
          {(isPromptsExpanded ? quickPrompts : quickPrompts.slice(0, 4)).map((prompt) => (
            <button
              key={prompt}
              type="button"
              className="hover:text-info min-w-0 cursor-pointer text-left text-sm duration-200 hover:opacity-60 disabled:pointer-events-none disabled:opacity-40"
              disabled={isSending || unavailable}
              onClick={() => sendMessage(prompt, { ignorePendingPlan: true })}
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

  return (
    <ContainerWithSideBar
      sidebar={<SideBar />}
      sidebarHeader={
        <div className="flex min-w-0 items-center gap-2 p-3 text-lg font-semibold">
          <BrainCog className="size-5 shrink-0" />
          <span className="min-w-0 truncate">{t('sideBarTitle')}</span>
        </div>
      }
      hideSidebarToggleButton={true}
      hideFloatBtnsOnMobile={true}
    >
      <NavBar title={t('title')} icon={<BrainCircuit className="size-5" />}>
        <div className="ml-auto flex items-center gap-2">
          {isSending && <Loader className="size-4 animate-spin" />}
          {messages.length > 0 && !isSending && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={clearChat}
              aria-label={t('clear')}
              title={t('clear')}
            >
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      </NavBar>

      <div className="flex min-h-[calc(100dvh-var(--nav-height,56px))] flex-col">
        <div className="flex-1 divide-y">
          {messages.length === 0 ? (
            <div className="flex flex-col justify-center gap-4 p-6">
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-lg font-semibold">
                  <Sparkles className="inline size-5" />
                  {t('empty.title')}
                </div>
                <div className="text-info max-w-md text-sm">{t('empty.desc')}</div>
              </div>
              <div className="relative flex max-w-xl flex-wrap items-center gap-2 pb-6">
                {(isPromptsExpanded ? quickPrompts : quickPrompts.slice(0, 4)).map((prompt) => (
                  <Button
                    key={prompt}
                    type="button"
                    variant="link"
                    className="h-auto cursor-pointer p-0 text-sm underline"
                    disabled={isSending || unavailable}
                    onClick={() => sendMessage(prompt, { ignorePendingPlan: true })}
                  >
                    {prompt}
                  </Button>
                ))}
                {!isPromptsExpanded && quickPrompts.length > 4 && (
                  <SoftBottom>
                    <div
                      className="text-info hover:text-foreground pointer-events-auto flex cursor-pointer items-center justify-center gap-1 text-sm duration-300"
                      onClick={() => setIsPromptsExpanded(true)}
                    >
                      <ArrowDownLeft className="size-4" /> {t('quick.expand')}
                    </div>
                  </SoftBottom>
                )}
                {isPromptsExpanded && quickPrompts.length > 4 && (
                  <div
                    className="text-info hover:text-foreground pointer-events-auto mt-1 flex w-full cursor-pointer items-center justify-center gap-1 text-sm duration-300"
                    onClick={() => setIsPromptsExpanded(false)}
                  >
                    <ArrowUpRight className="size-4" /> {t('quick.collapse')}
                  </div>
                )}
              </div>
            </div>
          ) : (
            messages.map((message) => <AiMessageItem key={message.id} message={message} />)
          )}
          <div ref={messageEndRef} className="h-24 shrink-0" />
        </div>

        <form
          className="bg-background sticky bottom-16 z-10 border-t px-3 py-1 sm:bottom-0"
          onSubmit={handleSubmit}
        >
          {isAutoScrollPaused && messages.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="absolute -top-12 left-1/2 z-20 size-8 -translate-x-1/2 rounded-full shadow-sm"
              onClick={returnToBottom}
              aria-label={t('backToBottom')}
              title={t('backToBottom')}
            >
              <ArrowDown className="size-4" />
            </Button>
          )}
          {unavailable && (
            <div className="text-info mb-2 px-1 text-sm font-light">{unavailableText}</div>
          )}
          <div className="flex items-center gap-2">
            <Input
              value={input}
              className="inputOrTextAreaInit focus:bg-foreground/3 rounded-md p-0 text-sm shadow-none"
              placeholder={t('inputPlaceholder')}
              disabled={isSending || unavailable}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleInputKeyDown}
            />
            <Button
              type="submit"
              size="sm"
              variant="ghost"
              className="shrink-0 rounded-md"
              disabled={!canSend}
              aria-label={t('send')}
              title={t('send')}
            >
              {isSending ? <Loader className="size-4 animate-spin" /> : <Send className="size-4" />}
            </Button>
          </div>
        </form>
      </div>
    </ContainerWithSideBar>
  );
}

export default AiMemoryPage;
