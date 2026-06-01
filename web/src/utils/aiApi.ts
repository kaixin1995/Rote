import { authService } from './auth';
import { get, getApiUrl, post, refreshAccessToken } from './api';

export type AiSourceType = 'rote' | 'article';

export interface AiStatus {
  enabled: boolean;
  vectorEnabled: boolean;
  publicExploreVectorEnabled: boolean;
  eligible: boolean;
  available: boolean;
}

export interface AiSemanticResult {
  id: string;
  ownerId: string;
  sourceType: AiSourceType;
  sourceId: string;
  chunkIndex: number;
  text: string;
  similarity: number;
  metadata: {
    title?: string;
    tags?: string[];
    state?: string;
    archived?: boolean;
    createdAt?: string;
    updatedAt?: string;
    [key: string]: unknown;
  };
}

export interface AiChatResponse {
  answer: string;
  sources: AiSemanticResult[];
  plan?: AiRetrievalPlan;
  clarification?: AiClarification;
}

export type AiRetrievalOperation =
  | 'summarize'
  | 'compare'
  | 'timeline'
  | 'find_open_loops'
  | 'analyze_mood'
  | 'analyze_stress'
  | 'analyze_personality';

export interface AiTimePlan {
  timeExpression: string | null;
  timeKind: 'none' | 'rolling' | 'calendar' | 'explicit_range' | 'all_time' | 'ambiguous';
  direction: 'current' | 'previous' | null;
  amount: number | null;
  unit: 'day' | 'week' | 'month' | 'year' | null;
  from: string | null;
  to: string | null;
  confidence: number;
  needsClarification: boolean;
  normalizedRange?: {
    from: string;
    to: string;
    label: string;
  } | null;
}

export interface AiRetrievalFilters {
  time: AiTimePlan | null;
  tags: {
    include: string[];
    exclude: string[];
    match: 'any' | 'all';
    unresolved: string[];
    confidence: number;
  };
  semanticScope: string[];
  sourceTypes: AiSourceType[];
  state: 'private' | 'public' | 'all';
  archived: boolean | null;
}

export interface AiRetrievalPlan {
  originalMessage?: string;
  operations: AiRetrievalOperation[];
  query: string;
  filters: AiRetrievalFilters;
  comparison: null | {
    mode: 'time' | 'tag_groups' | 'filter_groups';
    groups: Array<{
      label: string;
      filters: AiRetrievalFilters;
    }>;
  };
  confidence: number;
  needsClarification: boolean;
  clarificationQuestion: string | null;
  summary?: string[];
  retrievalNeeded: boolean;
  pagination: 'more' | null;
}

export interface AiClarification {
  question: string;
  pendingPlan: AiRetrievalPlan;
}

export type AiAgentPhase =
  | 'understanding'
  | 'planning'
  | 'tool_calling'
  | 'retrieving'
  | 'reading'
  | 'answering';

export interface AiAgentClientState {
  conversationId?: string;
  previousPlan?: AiRetrievalPlan | null;
  seenSourceIds?: string[];
  lastSources?: AiSemanticResult[];
  selectedContext?: {
    currentRoteId?: string;
    currentArticleId?: string;
    selectedSourceIds?: string[];
    selectedTags?: string[];
  } | null;
  stateVersion?: number;
}

export type AiChatStreamHandlers = {
  onRunStarted?: (runId: string) => void;
  onProgress?: (phase: AiAgentPhase, message: string) => void;
  onHeartbeat?: (phase: AiAgentPhase, message?: string) => void;
  onToolStarted?: (toolName: string, args?: unknown) => void;
  onToolProgress?: (toolName: string, message: string) => void;
  onToolFinished?: (toolName: string, summary?: string) => void;
  onPlan?: (plan: AiRetrievalPlan) => void;
  onClarification?: (clarification: AiClarification) => void;
  onSources?: (sources: AiSemanticResult[]) => void;
  onThinking?: (phase: 'planning' | 'answer', text: string) => void;
  onDelta?: (text: string) => void;
  onStatePatch?: (state: Partial<AiAgentClientState>) => void;
  onUsage?: (usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  }) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
};

export const getAiStatus = () => get('/ai/status').then((res) => res.data as AiStatus);

export type AiChatPayload = {
  message: string;
  mode?: 'chat' | 'review' | 'organize';
  limit?: number;
  pendingPlan?: AiRetrievalPlan | null;
  clarificationAnswer?: string;
  previousPlan?: AiRetrievalPlan | null;
  excludeIds?: string[];
  history?: { role: 'user' | 'assistant'; content: string }[];
  state?: AiAgentClientState | null;
  debug?: boolean;
};

export const aiChat = (payload: AiChatPayload) =>
  post('/ai/chat', payload).then((res) => res.data as AiChatResponse);

async function createAiStreamRequest(
  endpoint: '/ai/chat/stream' | '/ai/agent/stream',
  payload: AiChatPayload,
  signal?: AbortSignal
) {
  let token = authService.getAccessToken();
  const request = () =>
    fetch(`${getApiUrl()}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
      signal,
    });

  let response = await request();
  if (response.status === 401 && authService.hasValidRefreshToken()) {
    token = await refreshAccessToken();
    response = await request();
  }

  return response;
}

async function readResponseError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const body = JSON.parse(text);
    return body?.message || body?.error?.message || `Request failed with ${response.status}`;
  } catch {
    return text || `Request failed with ${response.status}`;
  }
}

function parseSseEvent(block: string): { event: string; data: unknown } | null {
  let event = 'message';
  const dataLines: string[] = [];

  block.split('\n').forEach((line) => {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  });

  if (dataLines.length === 0) return null;

  const dataText = dataLines.join('\n');
  try {
    return { event, data: JSON.parse(dataText) };
  } catch {
    return { event, data: dataText };
  }
}

export async function aiChatStream(
  payload: AiChatPayload,
  handlers: AiChatStreamHandlers,
  signal?: AbortSignal
): Promise<void> {
  const response = await createAiStreamRequest('/ai/chat/stream', payload, signal);
  await readAiStreamResponse(response, handlers);
}

export async function aiAgentStream(
  payload: AiChatPayload,
  handlers: AiChatStreamHandlers,
  signal?: AbortSignal
): Promise<void> {
  const response = await createAiStreamRequest('/ai/agent/stream', payload, signal);
  await readAiStreamResponse(response, handlers);
}

async function readAiStreamResponse(
  response: Response,
  handlers: AiChatStreamHandlers
): Promise<void> {
  if (!response.ok) {
    throw new Error(await readResponseError(response));
  }
  if (!response.body) {
    throw new Error('Streaming response is not supported in this browser');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let doneReceived = false;

  const dispatch = (block: string) => {
    const parsed = parseSseEvent(block);
    if (!parsed) return;

    if (parsed.event === 'run_started') {
      const runId = (parsed.data as { runId?: string })?.runId;
      if (runId) handlers.onRunStarted?.(runId);
    } else if (parsed.event === 'progress') {
      const data = parsed.data as { phase?: AiAgentPhase; message?: string };
      if (data.phase && typeof data.message === 'string') {
        handlers.onProgress?.(data.phase, data.message);
      }
    } else if (parsed.event === 'heartbeat') {
      const data = parsed.data as { phase?: AiAgentPhase; message?: string };
      if (data.phase) handlers.onHeartbeat?.(data.phase, data.message);
    } else if (parsed.event === 'tool_started') {
      const data = parsed.data as { toolName?: string; args?: unknown };
      if (data.toolName) handlers.onToolStarted?.(data.toolName, data.args);
    } else if (parsed.event === 'tool_progress') {
      const data = parsed.data as { toolName?: string; message?: string };
      if (data.toolName && typeof data.message === 'string') {
        handlers.onToolProgress?.(data.toolName, data.message);
      }
    } else if (parsed.event === 'tool_finished') {
      const data = parsed.data as { toolName?: string; summary?: string };
      if (data.toolName) handlers.onToolFinished?.(data.toolName, data.summary);
    } else if (parsed.event === 'plan') {
      const plan = (parsed.data as { plan?: AiRetrievalPlan })?.plan;
      if (plan) handlers.onPlan?.(plan);
    } else if (parsed.event === 'clarification') {
      const clarification = parsed.data as AiClarification;
      if (clarification?.question && clarification.pendingPlan) {
        handlers.onClarification?.(clarification);
      }
    } else if (parsed.event === 'sources') {
      const sources = (parsed.data as { sources?: AiSemanticResult[] })?.sources;
      handlers.onSources?.(Array.isArray(sources) ? sources : []);
    } else if (parsed.event === 'thinking') {
      const data = parsed.data as { phase?: 'planning' | 'answer'; text?: string };
      if ((data.phase === 'planning' || data.phase === 'answer') && typeof data.text === 'string') {
        handlers.onThinking?.(data.phase, data.text);
      }
    } else if (parsed.event === 'delta') {
      const text = (parsed.data as { text?: string })?.text;
      if (typeof text === 'string') handlers.onDelta?.(text);
    } else if (parsed.event === 'state_patch') {
      const state = (parsed.data as { state?: Partial<AiAgentClientState> })?.state;
      if (state) handlers.onStatePatch?.(state);
    } else if (parsed.event === 'usage') {
      const usage = parsed.data as {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      };
      if (usage) handlers.onUsage?.(usage);
    } else if (parsed.event === 'done') {
      doneReceived = true;
      handlers.onDone?.();
    } else if (parsed.event === 'error') {
      const message = (parsed.data as { message?: string })?.message || 'AI stream failed';
      handlers.onError?.(message);
      throw new Error(message);
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        dispatch(block);
        boundary = buffer.indexOf('\n\n');
      }
    }

    const tail = buffer.trim();
    if (tail) dispatch(tail);
    if (!doneReceived) handlers.onDone?.();
  } finally {
    reader.releaseLock();
  }
}

export const aiSearch = (payload: {
  query: string;
  scope?: 'mine' | 'public';
  sourceTypes?: AiSourceType[];
  timeRange?: { from: string; to: string; label?: string } | null;
  tags?: { include?: string[]; exclude?: string[]; match?: 'any' | 'all' };
  semanticScope?: string[];
  state?: 'private' | 'public' | 'all';
  archived?: boolean | null;
  limit?: number;
}) => post('/ai/search', payload).then((res) => res.data as AiSemanticResult[]);

export const getRelatedNotes = (payload: {
  sourceType: AiSourceType;
  sourceId: string;
  sourceTypes?: AiSourceType[];
  limit?: number;
}) => post('/ai/related-notes', payload).then((res) => res.data as AiSemanticResult[]);
