import type { AiConfig } from '../../../types/config';
import type { ChatCompletionUsage, ChatMessage, ChatToolCall, ChatToolDefinition } from '../client';
import type { AiRetrievalPlan, SemanticSearchResult } from '../../dbMethods/ai';

export type RoteAgentMode = 'chat' | 'review' | 'organize';

export type RoteAgentPhase =
  | 'understanding'
  | 'planning'
  | 'tool_calling'
  | 'retrieving'
  | 'reading'
  | 'answering';

export type RoteAgentClientState = {
  conversationId?: string;
  previousPlan?: AiRetrievalPlan | null;
  seenSourceIds?: string[];
  lastSources?: SemanticSearchResult[];
  selectedContext?: {
    currentRoteId?: string;
    currentArticleId?: string;
    selectedSourceIds?: string[];
    selectedTags?: string[];
  } | null;
  stateVersion?: number;
};

export type RoteAgentRequest = {
  message: string;
  mode?: RoteAgentMode;
  history?: { role: 'user' | 'assistant'; content: string }[];
  state?: RoteAgentClientState | null;
  selectedContext?: RoteAgentClientState['selectedContext'];
  debug?: boolean;
  limit?: number;
  previousPlan?: AiRetrievalPlan | null;
  excludeIds?: string[];
  pendingPlan?: AiRetrievalPlan | null;
  clarificationAnswer?: string;
};

export type RoteAgentPolicy = {
  maxIterations: number;
  maxToolCalls: number;
  maxSources: number;
  maxSourceChars: number;
  heartbeatMs: number;
  allowWrite: boolean;
};

export type RoteAgentStreamEvent =
  | { type: 'run_started'; runId: string }
  | { type: 'skill_selected'; skillName: string }
  | { type: 'progress'; phase: RoteAgentPhase; message: string }
  | { type: 'heartbeat'; phase: RoteAgentPhase; message?: string }
  | { type: 'tool_started'; toolName: string; args?: unknown }
  | { type: 'tool_progress'; toolName: string; message: string }
  | { type: 'tool_finished'; toolName: string; summary?: string }
  | { type: 'sources'; sources: SemanticSearchResult[] }
  | { type: 'plan'; plan: AiRetrievalPlan }
  | { type: 'clarification'; question: string; pendingPlan: AiRetrievalPlan }
  | { type: 'thinking'; phase: 'planning' | 'answer'; text: string }
  | { type: 'delta'; text: string }
  | { type: 'state_patch'; state: Partial<RoteAgentClientState> }
  | { type: 'usage'; usage: ChatCompletionUsage }
  | { type: 'done' }
  | { type: 'error'; message: string };

export type RoteAgentEmitter = (event: RoteAgentStreamEvent) => Promise<void> | void;

export type RoteAgentSourceRegistration = {
  index: number;
  source: SemanticSearchResult;
};

export type RoteAgentContext = {
  userId: string;
  requestId: string;
  request: RoteAgentRequest;
  config: AiConfig;
  mode: RoteAgentMode;
  policy: RoteAgentPolicy;
  state: RoteAgentClientState;
  emit: RoteAgentEmitter;
  registerSources: (sources: SemanticSearchResult[]) => RoteAgentSourceRegistration[];
  getSources: () => SemanticSearchResult[];
};

export type RoteAgentToolResult = {
  observations: string[];
  modelContent: string;
  sources?: SemanticSearchResult[];
  plan?: AiRetrievalPlan;
  statePatch?: Partial<RoteAgentClientState>;
  clarification?: { question: string; pendingPlan: AiRetrievalPlan };
};

export type RoteAgentTool = {
  definition: ChatToolDefinition;
  execute: (
    args: unknown,
    ctx: RoteAgentContext,
    call: ChatToolCall
  ) => Promise<RoteAgentToolResult>;
};

export class AgentToolCallingUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentToolCallingUnavailableError';
  }
}

export function isAgentToolCallingUnavailableError(
  error: unknown
): error is AgentToolCallingUnavailableError {
  return error instanceof AgentToolCallingUnavailableError;
}

export const DEFAULT_AGENT_POLICY: RoteAgentPolicy = {
  maxIterations: 4,
  maxToolCalls: 8,
  maxSources: 20,
  maxSourceChars: 12_000,
  heartbeatMs: 2_000,
  allowWrite: false,
};

export type { ChatMessage };
