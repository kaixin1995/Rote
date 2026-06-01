import { atomWithStorage } from 'jotai/utils';
import type { AiAgentPhase, AiRetrievalPlan, AiSemanticResult } from '@/utils/aiApi';

export type AiMessageMetrics = {
  planTime?: number;
  sourcesTime?: number;
  firstTokenTime?: number;
  totalTime?: number;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type AiMemoryMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: AiSemanticResult[];
  plan?: AiRetrievalPlan;
  pendingPlan?: AiRetrievalPlan;
  clarification?: boolean;
  error?: boolean;
  saved?: boolean;
  metrics?: AiMessageMetrics;
  thinking?: {
    planning?: string;
    answer?: string;
  };
  timeline?: Array<{
    id: string;
    type: 'progress' | 'tool';
    phase?: AiAgentPhase;
    toolName?: string;
    message: string;
    status: 'running' | 'done' | 'error';
    updatedAt: number;
  }>;
  /** Transient — never persisted. */
  isStreaming?: boolean;
};

export function getAiSourceKey(source: AiSemanticResult): string {
  return `${source.sourceType}:${source.sourceId}`;
}

export function sanitizeAiChatMessages(
  messages: AiMemoryMessage[],
  interruptedContent: string
): AiMemoryMessage[] {
  let changed = false;
  const nextMessages = messages.map((message) => {
    let next = message;

    if (next.isStreaming) {
      changed = true;
      const { isStreaming: _isStreaming, ...stableMessage } = next;
      const wasInterruptedAssistant = stableMessage.role === 'assistant' && !stableMessage.content;
      next = {
        ...stableMessage,
        content: wasInterruptedAssistant ? interruptedContent : stableMessage.content,
        error: wasInterruptedAssistant ? true : stableMessage.error,
      };
    }

    if (next.timeline?.some((entry) => entry.status === 'running')) {
      changed = true;
      next = {
        ...next,
        timeline: next.timeline.map((entry) =>
          entry.status === 'running' ? { ...entry, status: 'error' as const } : entry
        ),
      };
    }

    return next;
  });

  return changed ? nextMessages : messages;
}

export function getLatestAiAssistantPlan(messages: AiMemoryMessage[]): AiRetrievalPlan | null {
  return (
    [...messages].reverse().find((message) => message.role === 'assistant' && message.plan)?.plan ||
    null
  );
}

export function getLatestAiSources(messages: AiMemoryMessage[]): AiSemanticResult[] {
  return (
    [...messages]
      .reverse()
      .find((message) => message.role === 'assistant' && (message.sources?.length || 0) > 0)
      ?.sources || []
  );
}

export function getCurrentAiAssistantSources(messages: AiMemoryMessage[]): AiSemanticResult[] {
  return [...messages].reverse().find((message) => message.role === 'assistant')?.sources || [];
}

export function getSeenSourceIdsForActiveAiPlan(messages: AiMemoryMessage[]): string[] {
  const ids: string[] = [];

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'assistant') continue;

    if (message.sources?.length) {
      ids.push(...message.sources.map(getAiSourceKey));
    }

    if (message.plan && message.plan.pagination !== 'more') {
      break;
    }
  }

  return Array.from(new Set(ids)).slice(0, 500);
}

export const aiChatMessagesAtom = atomWithStorage<AiMemoryMessage[]>('aiChatMessages', []);
