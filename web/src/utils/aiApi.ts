import { authService } from './auth';
import { get, getApiUrl, post, refreshAccessToken } from './api';
import type {
  AiAgentClientState,
  AiAgentPhase,
  AiAgentToolProgressStatus,
  AiChatPayload,
  AiChatStreamHandlers,
  AiClientRequestContext,
  AiClarification,
  AiProviderTestProgressHandler,
  AiProviderTestResult,
  AiSemanticResult,
  AiStatus,
  AiThinkingPhase,
  AiTokenUsage,
  AiUsagePhase,
  ClientAgentBootstrap,
  ClientAgentToolResult,
  PlannerAgentDto,
  AiSourceType,
} from './aiTypes';

export type * from './aiTypes';

export const getAiStatus = () => get('/ai/status').then((res) => res.data as AiStatus);

export const testSiteAiProvider = (onProgress?: AiProviderTestProgressHandler) => {
  onProgress?.('site');
  return post('/ai/site/test', {}).then((res) => ({
    data: res.data as AiProviderTestResult,
    message: res.message,
  }));
};

function padDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

function formatUtcOffset(minutes: number): string {
  const sign = minutes >= 0 ? '+' : '-';
  const absolute = Math.abs(minutes);
  return `${sign}${padDatePart(Math.floor(absolute / 60))}:${padDatePart(absolute % 60)}`;
}

export function createAiClientRequestContext(now = new Date()): AiClientRequestContext {
  const resolvedOptions = Intl.DateTimeFormat().resolvedOptions();
  const utcOffsetMinutes = -now.getTimezoneOffset();
  const localDate = [
    now.getFullYear(),
    padDatePart(now.getMonth() + 1),
    padDatePart(now.getDate()),
  ].join('-');
  const localTime = [
    padDatePart(now.getHours()),
    padDatePart(now.getMinutes()),
    padDatePart(now.getSeconds()),
  ].join(':');

  return {
    nowIso: now.toISOString(),
    localDate,
    localDateTime: `${localDate}T${localTime}${formatUtcOffset(utcOffsetMinutes)}`,
    timeZone: resolvedOptions.timeZone,
    utcOffsetMinutes,
    locale: typeof navigator !== 'undefined' ? navigator.language : resolvedOptions.locale,
    calendar: resolvedOptions.calendar,
  };
}

export function buildAiClientTimeContextMessage(context: AiClientRequestContext): string {
  return [
    'Use the current request time context for relative date phrases.',
    `Client now (UTC): ${context.nowIso}`,
    `Client local date: ${context.localDate}`,
    `Client local date/time: ${context.localDateTime}`,
    context.timeZone ? `Client time zone: ${context.timeZone}` : null,
    `Client UTC offset minutes: ${context.utcOffsetMinutes}`,
    context.locale ? `Client locale: ${context.locale}` : null,
    context.calendar ? `Client calendar: ${context.calendar}` : null,
    'Resolve relative date phrases such as today, yesterday, this month, last month, 最近, 本月, and 上月 using this context.',
    'For Rote search tools, prefer structured timeRange preset/rolling/relative_between or pass the original phrase as timeExpression. Use from/to only for explicit absolute dates.',
    'For broad recent/latest record reviews or recurring-theme analysis, use selection recent with a default limit of 30 and dateField createdAt. Use updatedAt for modification/activity wording. For focused topics, use selection relevance with an explicit time range.',
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

export function withAiClientRequestContext(payload: AiChatPayload): AiChatPayload {
  const clientContext = payload.clientContext || createAiClientRequestContext();
  return {
    ...payload,
    clientContext,
    state: payload.state
      ? {
          ...payload.state,
          clientContext: payload.state.clientContext || clientContext,
        }
      : payload.state,
  };
}

export const getClientAgentBootstrap = () =>
  get('/ai/client-agent/bootstrap').then((res) => res.data as ClientAgentBootstrap);

export const executeClientAgentTool = (payload: {
  toolName: string;
  arguments: unknown;
  request: AiChatPayload;
  state?: AiAgentClientState | null;
  sourceKeys?: string[];
}) => {
  const request = withAiClientRequestContext(payload.request);
  return post('/ai/client-agent/tools/execute', {
    ...payload,
    request,
    state: payload.state
      ? {
          ...payload.state,
          clientContext: payload.state.clientContext || request.clientContext,
        }
      : payload.state,
  }).then((res) => res.data as ClientAgentToolResult);
};

async function createAiStreamRequest(
  endpoint: '/ai/chat/stream' | '/ai/agent/stream',
  payload: AiChatPayload,
  signal?: AbortSignal
) {
  const requestPayload = withAiClientRequestContext(payload);
  let token = authService.getAccessToken();
  const request = () =>
    fetch(`${getApiUrl()}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(requestPayload),
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
    const plainText = text
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (/Connection Closed|SGErrorDomain|Policy:/i.test(plainText)) {
      return `Local AI request was intercepted or closed by a proxy client. Add 127.0.0.1/localhost to the proxy bypass list, or try switching Base URL between http://127.0.0.1:8080/v1 and http://localhost:8080/v1. ${plainText.slice(0, 240)}`;
    }
    return plainText || text || `Request failed with ${response.status}`;
  }
}

function parseSseEvent(block: string): { event: string; data: unknown } | null {
  let event = 'message';
  const dataLines: string[] = [];
  block.split('\n').forEach((line) => {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
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
  if (!response.ok) throw new Error(await readResponseError(response));
  if (!response.body) throw new Error('Streaming response is not supported in this browser');

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
      const data = parsed.data as { phase?: AiAgentPhase };
      if (data.phase) handlers.onProgress?.(data.phase);
    } else if (parsed.event === 'heartbeat') {
      const data = parsed.data as { phase?: AiAgentPhase; seq?: number; timestamp?: string };
      if (data.phase && typeof data.seq === 'number' && typeof data.timestamp === 'string') {
        handlers.onHeartbeat?.({ phase: data.phase, seq: data.seq, timestamp: data.timestamp });
      }
    } else if (parsed.event === 'tool_started') {
      const data = parsed.data as { toolName?: string; args?: unknown };
      if (data.toolName) handlers.onToolStarted?.(data.toolName, data.args);
    } else if (parsed.event === 'tool_progress') {
      const data = parsed.data as { toolName?: string; status?: AiAgentToolProgressStatus };
      if (data.toolName && data.status) handlers.onToolProgress?.(data.toolName, data.status);
    } else if (parsed.event === 'tool_finished') {
      const data = parsed.data as { toolName?: string; summary?: string };
      if (data.toolName) handlers.onToolFinished?.(data.toolName, data.summary);
    } else if (parsed.event === 'plan') {
      const plan = (parsed.data as { plan?: PlannerAgentDto })?.plan;
      if (plan) handlers.onPlan?.(plan);
    } else if (parsed.event === 'clarification') {
      const clarification = parsed.data as AiClarification;
      if (clarification?.question) handlers.onClarification?.(clarification);
    } else if (parsed.event === 'sources') {
      const sources = (parsed.data as { sources?: AiSemanticResult[] })?.sources;
      handlers.onSources?.(Array.isArray(sources) ? sources : []);
    } else if (parsed.event === 'thinking') {
      const data = parsed.data as { phase?: AiThinkingPhase; text?: string };
      if (
        (data.phase === 'route_decision' ||
          data.phase === 'evidence_decision' ||
          data.phase === 'retrieval_planning' ||
          data.phase === 'answer') &&
        typeof data.text === 'string'
      ) {
        handlers.onThinking?.(data.phase, data.text);
      }
    } else if (parsed.event === 'delta') {
      const text = (parsed.data as { text?: string })?.text;
      if (typeof text === 'string') handlers.onDelta?.(text);
    } else if (parsed.event === 'state_patch') {
      const state = (parsed.data as { state?: Partial<AiAgentClientState> })?.state;
      if (state) handlers.onStatePatch?.(state);
    } else if (parsed.event === 'usage') {
      const data = parsed.data as { phase?: AiUsagePhase; usage?: Partial<AiTokenUsage> };
      const rawUsage = data.usage;
      if (
        data.phase &&
        rawUsage &&
        typeof rawUsage.prompt_tokens === 'number' &&
        typeof rawUsage.completion_tokens === 'number' &&
        typeof rawUsage.total_tokens === 'number'
      ) {
        handlers.onUsage?.(
          {
            prompt_tokens: rawUsage.prompt_tokens,
            completion_tokens: rawUsage.completion_tokens,
            total_tokens: rawUsage.total_tokens,
          },
          data.phase
        );
      }
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
