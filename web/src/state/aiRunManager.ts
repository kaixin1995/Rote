import { getDefaultStore } from 'jotai';
import { toast } from 'sonner';
import {
  aiAgentStream,
  type AiAgentClientState,
  type AiAgentPhase,
  type AiAgentToolProgressStatus,
  type AiTokenUsage,
  type AiUsagePhase,
} from '@/utils/aiApi';
import {
  aiChatMessagesAtom,
  aiRunStateAtom,
  getAiSourceKey,
  getLatestAiAssistantPlan,
  getSeenSourceIdsForActiveAiPlan,
  mergeAiTokenUsage,
  mergeAiTokenUsageByPhase,
  settleAiMessageTimeline,
  type AiMemoryMessage,
} from '@/state/aiChat';

type ActiveStream = {
  id: string;
  content: string;
  targetContent: string;
  frame: number | null;
  done: boolean;
  drainResolver?: () => void;
};

type ActiveRun = {
  assistantId: string;
  controller: AbortController;
};

export type AiRunLabels = {
  phase: (phase: AiAgentPhase) => string;
  toolStarted: (toolName: string) => string;
  toolStatus: (status: AiAgentToolProgressStatus) => string;
  toolFinished: (toolName: string) => string;
  sourcesFound: (count: number) => string;
  askFailed: string;
  fallbackNoAnswerWithSources: string;
  fallbackNoAnswerNoSources: string;
};

type StartAiRunParams = {
  question: string;
  messages: AiMemoryMessage[];
  pendingPlan: AiMemoryMessage['pendingPlan'] | null;
  ignorePendingPlan?: boolean;
  unavailable: boolean;
  labels: AiRunLabels;
};

const store = getDefaultStore();

let activeRun: ActiveRun | null = null;
let activeStream: ActiveStream | null = null;
let isSending = false;
let currentIsMore = false;
let seenSourceIds = new Set<string>();
let agentState: AiAgentClientState = {
  conversationId: createAiMessageId(),
  seenSourceIds: [],
  stateVersion: 1,
};

export function createAiMessageId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getStreamRevealSize(backlog: number) {
  if (backlog > 1200) return 240;
  if (backlog > 500) return 160;
  return 80;
}

export function isAiRunActive() {
  return isSending && !!activeRun;
}

function setRunState(next: { isSending: boolean; assistantId?: string }) {
  isSending = next.isSending;
  store.set(aiRunStateAtom, next);
}

function isActiveRun(assistantId: string) {
  return activeRun?.assistantId === assistantId;
}

function setMessagesForActiveRun(
  assistantId: string,
  updater: (messages: AiMemoryMessage[]) => AiMemoryMessage[]
) {
  if (!isActiveRun(assistantId)) return;
  store.set(aiChatMessagesAtom, updater);
}

function flushStreamContent(assistantId: string, options: { force?: boolean } = {}) {
  if (!isActiveRun(assistantId)) return;
  const stream = activeStream;
  if (!stream || stream.id !== assistantId) return;

  stream.frame = null;
  const backlog = stream.targetContent.length - stream.content.length;
  if (options.force) {
    stream.content = stream.targetContent;
  } else if (backlog > 0) {
    stream.content = stream.targetContent.slice(
      0,
      stream.content.length + getStreamRevealSize(backlog)
    );
  }

  setMessagesForActiveRun(assistantId, (prev) =>
    prev.map((message) =>
      message.id === assistantId ? { ...message, content: stream.content } : message
    )
  );

  if (!options.force && stream.content.length < stream.targetContent.length) {
    stream.frame = window.requestAnimationFrame(() => flushStreamContent(assistantId));
    return;
  }

  if (stream.done) {
    stream.drainResolver?.();
    stream.drainResolver = undefined;
  }
}

function queueStreamDelta(assistantId: string, text: string) {
  if (!isActiveRun(assistantId)) return;
  const stream = activeStream;
  if (!stream || stream.id !== assistantId) return;

  stream.targetContent += text;
  if (stream.frame === null) {
    stream.frame = window.requestAnimationFrame(() => flushStreamContent(assistantId));
  }
}

function drainStreamContent(assistantId: string): Promise<void> {
  if (!isActiveRun(assistantId)) return Promise.resolve();
  const stream = activeStream;
  if (!stream || stream.id !== assistantId) return Promise.resolve();

  stream.done = true;
  if (stream.content.length >= stream.targetContent.length) return Promise.resolve();

  if (document.visibilityState !== 'visible') {
    flushStreamContent(assistantId, { force: true });
    return Promise.resolve();
  }

  if (stream.frame === null) {
    stream.frame = window.requestAnimationFrame(() => flushStreamContent(assistantId));
  }
  return new Promise((resolve) => {
    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      flushStreamContent(assistantId, { force: true });
      if (stream.drainResolver === finish) {
        stream.drainResolver = undefined;
      }
      resolve();
    };
    stream.drainResolver = finish;
    window.setTimeout(finish, 3000);
  });
}

function updateTimeline(
  assistantId: string,
  item: {
    id: string;
    type: 'progress' | 'tool';
    phase?: AiAgentPhase;
    toolName?: string;
    toolStatus?: AiAgentToolProgressStatus;
    message: string;
    status?: 'running' | 'done' | 'error';
  }
) {
  if (!isActiveRun(assistantId)) return;
  const updatedAt = Date.now();
  setMessagesForActiveRun(assistantId, (prev) =>
    prev.map((message) => {
      if (message.id !== assistantId) return message;
      const current = message.timeline || [];
      const existingIndex = current.findIndex((entry) => entry.id === item.id);
      const nextItem = {
        id: item.id,
        type: item.type,
        phase: item.phase,
        toolName: item.toolName,
        toolStatus: item.toolStatus,
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

function mergeAgentState(
  state: Partial<AiAgentClientState>,
  options: { replaceSeenSourceIds?: boolean } = {}
) {
  const previous = agentState;
  const nextSeenSourceIds = options.replaceSeenSourceIds
    ? new Set(state.seenSourceIds || [])
    : new Set([...(previous.seenSourceIds || []), ...(state.seenSourceIds || [])]);
  agentState = {
    ...previous,
    ...state,
    seenSourceIds: Array.from(nextSeenSourceIds).slice(0, 500),
  };
}

function addUsage(assistantId: string, usage: AiTokenUsage, phase: AiUsagePhase) {
  setMessagesForActiveRun(assistantId, (prev) =>
    prev.map((message) =>
      message.id === assistantId
        ? {
            ...message,
            metrics: {
              ...message.metrics,
              usage: mergeAiTokenUsage(message.metrics?.usage, usage),
              usageByPhase: mergeAiTokenUsageByPhase(message.metrics?.usageByPhase, phase, usage),
            },
          }
        : message
    )
  );
}

export function syncAiRunStateFromMessages(messages: AiMemoryMessage[]) {
  if (isSending) return;
  const nextSeenSourceIds = getSeenSourceIdsForActiveAiPlan(messages);
  seenSourceIds = new Set(nextSeenSourceIds);
  agentState = {
    ...agentState,
    previousPlan: getLatestAiAssistantPlan(messages),
    seenSourceIds: nextSeenSourceIds,
    stateVersion: 1,
  };
}

export function clearAiRun() {
  activeRun?.controller.abort();
  if (activeStream?.frame !== null && activeStream?.frame !== undefined) {
    window.cancelAnimationFrame(activeStream.frame);
  }
  activeRun = null;
  activeStream = null;
  currentIsMore = false;
  seenSourceIds.clear();
  agentState = {
    conversationId: createAiMessageId(),
    seenSourceIds: [],
    stateVersion: 1,
  };
  setRunState({ isSending: false });
  store.set(aiChatMessagesAtom, []);
}

export async function startAiRun(params: StartAiRunParams): Promise<boolean> {
  const question = params.question.trim();
  if (!question || isSending || params.unavailable) return false;

  const validHistory = params.messages
    .filter((message) => !message.error && !message.isStreaming && message.content)
    .map((message) => ({ role: message.role, content: message.content }))
    .slice(-6);

  const activePendingPlan = params.ignorePendingPlan ? null : params.pendingPlan;
  currentIsMore = false;
  const assistantId = createAiMessageId();
  const controller = new AbortController();
  let receivedClarification = false;
  const start = performance.now();
  let firstTokenTime: number | undefined;

  activeRun = { assistantId, controller };
  activeStream = {
    id: assistantId,
    content: '',
    targetContent: '',
    frame: null,
    done: false,
  };
  setRunState({ isSending: true, assistantId });

  store.set(aiChatMessagesAtom, (prev) => [
    ...prev,
    {
      id: createAiMessageId(),
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
    const previousPlan = params.ignorePendingPlan
      ? null
      : getLatestAiAssistantPlan(params.messages);
    const excludeIds = seenSourceIds.size > 0 ? Array.from(seenSourceIds) : undefined;

    await aiAgentStream(
      {
        message: question,
        pendingPlan: activePendingPlan,
        clarificationAnswer: activePendingPlan ? question : undefined,
        previousPlan,
        excludeIds,
        history: validHistory.length > 0 ? validHistory : undefined,
        state: {
          ...agentState,
          previousPlan,
          seenSourceIds: excludeIds,
          stateVersion: 1,
        },
      },
      {
        onRunStarted: (runId) => {
          if (!isActiveRun(assistantId)) return;
          mergeAgentState({ conversationId: runId });
        },
        onProgress: (phase) => {
          updateTimeline(assistantId, {
            id: `progress-${phase}`,
            type: 'progress',
            phase,
            message: params.labels.phase(phase),
          });
        },
        onToolStarted: (toolName) => {
          updateTimeline(assistantId, {
            id: `tool-${toolName}`,
            type: 'tool',
            toolName,
            message: params.labels.toolStarted(toolName),
          });
        },
        onToolProgress: (toolName, status) => {
          updateTimeline(assistantId, {
            id: `tool-${toolName}`,
            type: 'tool',
            toolName,
            toolStatus: status,
            message: params.labels.toolStatus(status),
          });
        },
        onToolFinished: (toolName) => {
          if (toolName === 'rote_search_notes') return;
          updateTimeline(assistantId, {
            id: `tool-${toolName}`,
            type: 'tool',
            toolName,
            message: params.labels.toolFinished(toolName),
            status: 'done',
          });
        },
        onPlan: (plan) => {
          if (!isActiveRun(assistantId)) return;
          currentIsMore = false;
          seenSourceIds.clear();
          mergeAgentState(
            { previousPlan: plan, seenSourceIds: [] },
            { replaceSeenSourceIds: true }
          );
          const planTime = performance.now() - start;
          setMessagesForActiveRun(assistantId, (prev) =>
            prev.map((message) =>
              message.id === assistantId
                ? { ...message, plan, metrics: { ...message.metrics, planTime } }
                : message
            )
          );
        },
        onClarification: (clarification) => {
          if (!isActiveRun(assistantId)) return;
          receivedClarification = true;
          const planTime = performance.now() - start;

          setMessagesForActiveRun(assistantId, (prev) =>
            prev.map((message) =>
              message.id === assistantId
                ? settleAiMessageTimeline(
                    {
                      ...message,
                      content: clarification.question,
                      plan: clarification.pendingPlan ?? undefined,
                      pendingPlan: clarification.pendingPlan ?? undefined,
                      clarification: true,
                      isStreaming: false,
                      metrics: {
                        ...message.metrics,
                        planTime,
                        totalTime: performance.now() - start,
                      },
                    },
                    'done'
                  )
                : message
            )
          );
        },
        onSources: (sources) => {
          if (!isActiveRun(assistantId)) return;
          sources.forEach((source) => seenSourceIds.add(getAiSourceKey(source)));
          mergeAgentState(
            {
              seenSourceIds: Array.from(seenSourceIds),
            },
            { replaceSeenSourceIds: !currentIsMore }
          );
          const sourcesTime = performance.now() - start;
          updateTimeline(assistantId, {
            id: 'tool-rote_search_notes',
            type: 'tool',
            toolName: 'rote_search_notes',
            message: params.labels.sourcesFound(sources.length),
            status: 'done',
          });
          setMessagesForActiveRun(assistantId, (prev) =>
            prev.map((message) =>
              message.id === assistantId
                ? { ...message, sources, metrics: { ...message.metrics, sourcesTime } }
                : message
            )
          );
        },
        onThinking: (phase, text) => {
          setMessagesForActiveRun(assistantId, (prev) =>
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
          if (!isActiveRun(assistantId)) return;
          if (!firstTokenTime) {
            firstTokenTime = performance.now() - start;
            setMessagesForActiveRun(assistantId, (prev) =>
              prev.map((message) =>
                message.id === assistantId
                  ? { ...message, metrics: { ...message.metrics, firstTokenTime } }
                  : message
              )
            );
          }
          queueStreamDelta(assistantId, text);
        },
        onUsage: (usage, phase) => {
          addUsage(assistantId, usage, phase);
        },
        onStatePatch: (state) => {
          if (!isActiveRun(assistantId)) return;
          const nextState = currentIsMore
            ? state
            : {
                ...state,
                seenSourceIds: Array.from(seenSourceIds),
              };
          mergeAgentState(nextState, { replaceSeenSourceIds: !currentIsMore });
          if (currentIsMore && state.seenSourceIds?.length) {
            state.seenSourceIds.forEach((id) => seenSourceIds.add(id));
          }
        },
      },
      controller.signal
    );

    if (!receivedClarification) {
      await drainStreamContent(assistantId);
    }
    setMessagesForActiveRun(assistantId, (prev) => {
      const totalTime = performance.now() - start;
      return prev.map((message) =>
        message.id === assistantId
          ? settleAiMessageTimeline(
              {
                ...message,
                isStreaming: false,
                pendingPlan: receivedClarification ? message.pendingPlan : undefined,
                metrics: { ...message.metrics, totalTime },
              },
              'done'
            )
          : message
      );
    });
  } catch (error: any) {
    const aborted = controller.signal.aborted || error?.name === 'AbortError';
    if (aborted) return true;

    let fallbackMessage =
      error?.response?.data?.message || error?.message || params.labels.askFailed;

    if (fallbackMessage === 'error_no_answer_with_sources') {
      fallbackMessage = params.labels.fallbackNoAnswerWithSources;
    } else if (fallbackMessage === 'error_no_answer_no_sources') {
      fallbackMessage = params.labels.fallbackNoAnswerNoSources;
    }
    const streamContent = activeStream?.targetContent || activeStream?.content || '';
    flushStreamContent(assistantId, { force: true });
    setMessagesForActiveRun(assistantId, (prev) =>
      prev.map((message) =>
        message.id === assistantId
          ? settleAiMessageTimeline(
              {
                ...message,
                content: streamContent || fallbackMessage,
                error: streamContent ? message.error : true,
                isStreaming: false,
              },
              'error'
            )
          : message
      )
    );
    if (streamContent) {
      toast.error(fallbackMessage);
    }
  } finally {
    const finishingActiveRun = activeRun?.assistantId === assistantId;
    if (activeStream?.id === assistantId && activeStream.frame !== null) {
      window.cancelAnimationFrame(activeStream.frame);
    }
    if (activeStream?.id === assistantId) {
      activeStream = null;
    }
    if (finishingActiveRun) {
      activeRun = null;
      setRunState({ isSending: false });
    }
  }

  return true;
}
