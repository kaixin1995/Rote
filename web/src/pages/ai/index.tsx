import { AiSourceList, getAiSourcePath } from '@/components/ai/AiSourceList';
import NavBar from '@/components/layout/navBar';
import { SoftBottom } from '@/components/others/SoftBottom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import ContainerWithSideBar from '@/layout/ContainerWithSideBar';
import type { AiMemoryMessage } from '@/state/aiChat';
import { aiChatMessagesAtom } from '@/state/aiChat';
import {
  aiAgentStream,
  getAiStatus,
  type AiAgentClientState,
  type AiAgentPhase,
} from '@/utils/aiApi';
import { post } from '@/utils/api';
import { useAPIGet } from '@/utils/fetcher';
import { useAtom } from 'jotai';
import {
  ArrowDownLeft,
  ArrowUpRight,
  BrainCircuit,
  BrainCog,
  Loader,
  RefreshCw,
  Send,
  Sparkles,
  ToggleLeft,
  ToggleRight,
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

import { toast } from 'sonner';

type ActiveStream = {
  id: string;
  content: string;
  frame: number | null;
};

function createMessageId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildSavedNoteContent(message: AiMemoryMessage, sourceTitle: string) {
  const origin = window.location.origin;
  const sourceLines = (message.sources || [])
    .map((source, index) => `[${index + 1}] ${origin}${getAiSourcePath(source)}`)
    .join('\n');

  return sourceLines
    ? `${message.content}\n\n---\n${sourceTitle}\n${sourceLines}`
    : message.content;
}

import { AiMessageItem } from '@/components/ai/AiMessageItem';

function AiMemoryPage() {
  const { t } = useTranslation('translation', { keyPrefix: 'pages.aiMemory' });
  const [messages, setMessages] = useAtom(aiChatMessagesAtom);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [savingMessageId, setSavingMessageId] = useState<string | null>(null);
  const [isPromptsExpanded, setIsPromptsExpanded] = useState(false);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const activeStreamRef = useRef<ActiveStream | null>(null);
  const seenSourceIdsRef = useRef<Set<string>>(new Set());
  const agentStateRef = useRef<AiAgentClientState>({
    conversationId: createMessageId(),
    seenSourceIds: [],
    stateVersion: 1,
  });
  const currentIsMoreRef = useRef(false);

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

  const latestSources = useMemo(() => {
    const assistantMessages = messages.filter((message) => message.role === 'assistant');
    return assistantMessages[assistantMessages.length - 1]?.sources || [];
  }, [messages]);
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

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, isSending]);

  useEffect(
    () => () => {
      if (activeStreamRef.current?.frame !== null && activeStreamRef.current?.frame !== undefined) {
        window.cancelAnimationFrame(activeStreamRef.current.frame);
      }
    },
    []
  );

  const clearChat = useCallback(() => {
    setMessages([]);
    seenSourceIdsRef.current.clear();
    agentStateRef.current = {
      conversationId: createMessageId(),
      seenSourceIds: [],
      stateVersion: 1,
    };
  }, [setMessages]);

  function flushStreamContent(assistantId: string) {
    const stream = activeStreamRef.current;
    if (!stream || stream.id !== assistantId) return;

    stream.frame = null;
    setMessages((prev) =>
      prev.map((message) =>
        message.id === assistantId ? { ...message, content: stream.content } : message
      )
    );
  }

  function queueStreamDelta(assistantId: string, text: string) {
    const stream = activeStreamRef.current;
    if (!stream || stream.id !== assistantId) return;

    stream.content += text;
    if (stream.frame === null) {
      stream.frame = window.requestAnimationFrame(() => flushStreamContent(assistantId));
    }
  }

  function updateTimeline(
    assistantId: string,
    item: {
      id: string;
      type: 'progress' | 'tool';
      phase?: AiAgentPhase;
      toolName?: string;
      message: string;
      status?: 'running' | 'done' | 'error';
    }
  ) {
    const updatedAt = Date.now();
    setMessages((prev) =>
      prev.map((message) => {
        if (message.id !== assistantId) return message;
        const current = message.timeline || [];
        const existingIndex = current.findIndex((entry) => entry.id === item.id);
        const nextItem = {
          id: item.id,
          type: item.type,
          phase: item.phase,
          toolName: item.toolName,
          message: item.message,
          status: item.status || 'running',
          updatedAt,
        };
        const next =
          existingIndex >= 0
            ? current.map((entry, index) =>
                index === existingIndex ? { ...entry, ...nextItem } : entry
              )
            : [...current, nextItem];
        return { ...message, timeline: next.slice(-10) };
      })
    );
  }

  function mergeAgentState(state: Partial<AiAgentClientState>) {
    const previous = agentStateRef.current;
    const seenSourceIds = new Set([
      ...(previous.seenSourceIds || []),
      ...(state.seenSourceIds || []),
    ]);
    agentStateRef.current = {
      ...previous,
      ...state,
      seenSourceIds: Array.from(seenSourceIds).slice(0, 500),
    };
  }

  async function sendMessage(value: string, options: { ignorePendingPlan?: boolean } = {}) {
    const question = value.trim();
    if (!question || isSending || unavailable) return;

    const validHistory = messages
      .filter((m) => !m.error && !m.isStreaming && m.content)
      .map((m) => ({ role: m.role, content: m.content }))
      .slice(-6); // Keep last 6 messages (3 turns)

    const activePendingPlan = options.ignorePendingPlan ? null : pendingPlan;
    setInput('');
    setIsSending(true);
    const assistantId = createMessageId();
    let receivedClarification = false;
    const start = performance.now();
    let firstTokenTime: number | undefined;

    activeStreamRef.current = { id: assistantId, content: '', frame: null };
    setMessages((prev) => [
      ...prev,
      {
        id: createMessageId(),
        role: 'user',
        content: question,
      },
      {
        id: assistantId,
        role: 'assistant',
        content: '',
        sources: [],
        isStreaming: true,
      },
    ]);

    try {
      // Build previousPlan from the last assistant message
      const lastAssistantForPlan = [...messages].reverse().find((m) => m.role === 'assistant');
      const previousPlan = options.ignorePendingPlan ? null : lastAssistantForPlan?.plan || null;

      // Always pass accumulated seen source IDs (server decides whether to use them)
      const excludeIds =
        seenSourceIdsRef.current.size > 0 ? Array.from(seenSourceIdsRef.current) : undefined;

      await aiAgentStream(
        {
          message: question,
          limit: 8,
          pendingPlan: activePendingPlan,
          clarificationAnswer: activePendingPlan ? question : undefined,
          previousPlan,
          excludeIds,
          history: validHistory.length > 0 ? validHistory : undefined,
          state: {
            ...agentStateRef.current,
            previousPlan,
            seenSourceIds: excludeIds,
            lastSources: latestSources,
            stateVersion: 1,
          },
        },
        {
          onRunStarted: (runId) => {
            mergeAgentState({ conversationId: runId });
          },
          onProgress: (phase, message) => {
            updateTimeline(assistantId, {
              id: `progress-${phase}`,
              type: 'progress',
              phase,
              message,
            });
          },
          onHeartbeat: (phase, message) => {
            updateTimeline(assistantId, {
              id: `progress-${phase}`,
              type: 'progress',
              phase,
              message: message || '...',
            });
          },
          onToolStarted: (toolName) => {
            updateTimeline(assistantId, {
              id: `tool-${toolName}`,
              type: 'tool',
              toolName,
              message: toolName,
            });
          },
          onToolProgress: (toolName, message) => {
            updateTimeline(assistantId, {
              id: `tool-${toolName}`,
              type: 'tool',
              toolName,
              message,
            });
          },
          onToolFinished: (toolName, summary) => {
            updateTimeline(assistantId, {
              id: `tool-${toolName}`,
              type: 'tool',
              toolName,
              message: summary || toolName,
              status: 'done',
            });
          },
          onPlan: (plan) => {
            currentIsMoreRef.current = plan.pagination === 'more';
            if (!currentIsMoreRef.current) {
              seenSourceIdsRef.current.clear();
            }
            mergeAgentState({ previousPlan: plan });
            const planTime = performance.now() - start;
            setMessages((prev) =>
              prev.map((message) =>
                message.id === assistantId
                  ? { ...message, plan, metrics: { ...message.metrics, planTime } }
                  : message
              )
            );
          },
          onClarification: (clarification) => {
            receivedClarification = true;
            const planTime = performance.now() - start;
            setMessages((prev) =>
              prev.map((message) =>
                message.id === assistantId
                  ? {
                      ...message,
                      content: clarification.question,
                      plan: clarification.pendingPlan,
                      pendingPlan: clarification.pendingPlan,
                      clarification: true,
                      isStreaming: false,
                      metrics: {
                        ...message.metrics,
                        planTime,
                        totalTime: performance.now() - start,
                      },
                    }
                  : message
              )
            );
          },
          onSources: (sources) => {
            sources.forEach((s) => seenSourceIdsRef.current.add(`${s.sourceType}:${s.sourceId}`));
            mergeAgentState({
              lastSources: sources,
              seenSourceIds: Array.from(seenSourceIdsRef.current),
            });
            const sourcesTime = performance.now() - start;
            setMessages((prev) =>
              prev.map((message) =>
                message.id === assistantId
                  ? { ...message, sources, metrics: { ...message.metrics, sourcesTime } }
                  : message
              )
            );
          },
          onThinking: (phase, text) => {
            setMessages((prev) =>
              prev.map((message) =>
                message.id === assistantId
                  ? {
                      ...message,
                      thinking: {
                        ...message.thinking,
                        [phase]: `${message.thinking?.[phase] || ''}${text}`,
                      },
                    }
                  : message
              )
            );
          },
          onDelta: (text) => {
            if (!firstTokenTime) {
              firstTokenTime = performance.now() - start;
              setMessages((prev) =>
                prev.map((message) =>
                  message.id === assistantId
                    ? { ...message, metrics: { ...message.metrics, firstTokenTime } }
                    : message
                )
              );
            }
            queueStreamDelta(assistantId, text);
          },
          onUsage: (usage) => {
            setMessages((prev) =>
              prev.map((message) =>
                message.id === assistantId
                  ? { ...message, metrics: { ...message.metrics, usage } }
                  : message
              )
            );
          },
          onStatePatch: (state) => {
            mergeAgentState(state);
            if (state.seenSourceIds?.length) {
              state.seenSourceIds.forEach((id) => seenSourceIdsRef.current.add(id));
            }
          },
        }
      );
      if (!receivedClarification) {
        flushStreamContent(assistantId);
      }
      setMessages((prev) => {
        const totalTime = performance.now() - start;
        return prev.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                isStreaming: false,
                pendingPlan: receivedClarification ? message.pendingPlan : undefined,
                metrics: { ...message.metrics, totalTime },
              }
            : message
        );
      });
    } catch (error: any) {
      const fallbackMessage =
        error?.response?.data?.message || error?.message || t('messages.askFailed');
      const streamContent = activeStreamRef.current?.content || '';
      flushStreamContent(assistantId);
      setMessages((prev) =>
        prev.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                content: streamContent || fallbackMessage,
                error: streamContent ? message.error : true,
                isStreaming: false,
              }
            : message
        )
      );
      if (streamContent) {
        toast.error(fallbackMessage);
      }
    } finally {
      if (activeStreamRef.current?.id === assistantId && activeStreamRef.current.frame !== null) {
        window.cancelAnimationFrame(activeStreamRef.current.frame);
      }
      if (activeStreamRef.current?.id === assistantId) {
        activeStreamRef.current = null;
      }
      setIsSending(false);
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

  async function saveAsNote(message: AiMemoryMessage) {
    if (savingMessageId) return;

    setSavingMessageId(message.id);
    try {
      await post('/notes', {
        title: t('savedNoteTitle'),
        content: buildSavedNoteContent(message, t('savedSourceTitle')),
        tags: ['ai-memory'],
        state: 'private',
        archived: false,
        pin: false,
        editor: 'markdown',
      });
      setMessages((prev) =>
        prev.map((item) => (item.id === message.id ? { ...item, saved: true } : item))
      );
      toast.success(t('messages.saveSuccess'));
    } catch (error: any) {
      toast.error(error?.response?.data?.message || error?.message || t('messages.saveFailed'));
    } finally {
      setSavingMessageId(null);
    }
  }

  const StatusBlock = () => (
    <div className="flex items-center justify-between border-b p-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        {status?.available ? (
          <ToggleRight className="size-4" />
        ) : (
          <ToggleLeft className="text-error size-4" />
        )}
        {t('status.title')}
      </div>
      <div className="text-info flex items-center gap-2 text-xs">
        {isStatusLoading ? (
          t('status.checking')
        ) : status?.available ? (
          t('status.ready')
        ) : (
          <button className="hover:text-theme duration-200" onClick={() => refreshStatus()}>
            {unavailableText}
          </button>
        )}
        {isStatusValidating && <RefreshCw className="text-theme size-3 animate-spin" />}
      </div>
    </div>
  );

  const SideBar = () => (
    <div className="divide-y">
      <StatusBlock />
      <div className="p-4">
        <div className="text-sm font-semibold">{t('quick.title')}</div>
        <div className="relative mt-3 flex flex-col gap-2 pb-6">
          {(isPromptsExpanded ? quickPrompts : quickPrompts.slice(0, 4)).map((prompt) => (
            <Button
              key={prompt}
              type="button"
              variant="link"
              className="h-auto cursor-pointer justify-start p-0 text-sm font-normal whitespace-normal underline"
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
      <ScrollArea className="max-h-[45dvh]">
        <AiSourceList
          sources={latestSources}
          title={t('sources.title')}
          emptyLabel={t('sources.empty')}
        />
      </ScrollArea>
    </div>
  );

  return (
    <ContainerWithSideBar
      sidebar={<SideBar />}
      sidebarHeader={
        <div className="flex items-center gap-2 p-3 text-lg font-semibold">
          <BrainCog className="size-5" />
          {t('sideBarTitle')}
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
            messages.map((message) => (
              <AiMessageItem
                key={message.id}
                message={message}
                savingMessageId={savingMessageId}
                saveAsNote={saveAsNote}
              />
            ))
          )}
          <div ref={messageEndRef} className="h-24 shrink-0" />
        </div>

        <form
          className="bg-background sticky bottom-16 z-10 border-t px-3 py-1 sm:bottom-0"
          onSubmit={handleSubmit}
        >
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
