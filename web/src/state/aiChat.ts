import { atomWithStorage } from 'jotai/utils';
import type { AiRetrievalPlan, AiSemanticResult } from '@/utils/aiApi';

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
  /** Transient — never persisted. */
  isStreaming?: boolean;
};

export const aiChatMessagesAtom = atomWithStorage<AiMemoryMessage[]>('aiChatMessages', []);
