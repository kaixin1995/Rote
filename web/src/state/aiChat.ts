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

export const aiChatMessagesAtom = atomWithStorage<AiMemoryMessage[]>('aiChatMessages', []);
