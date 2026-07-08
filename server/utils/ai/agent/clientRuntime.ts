import type { AiConfig } from '../../../types/config';
import type { SemanticSearchResult } from '../../dbMethods/ai';
import type { ChatToolCall } from '../client';
import { getNativeRoteTools } from './tools';
import {
  DEFAULT_AGENT_POLICY,
  type RoteAgentClientContext,
  type RoteAgentClientState,
  type RoteAgentContext,
  type RoteAgentRequest,
  type RoteAgentSourceRegistration,
} from './types';

function sourceKey(source: SemanticSearchResult): string {
  return `${source.sourceType}:${source.sourceId}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sanitizeString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function sanitizeUtcOffsetMinutes(value: unknown): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  const minutes = Math.trunc(numeric);
  return minutes >= -14 * 60 && minutes <= 14 * 60 ? minutes : undefined;
}

function sanitizeClientContext(value: unknown): RoteAgentClientContext | null {
  const raw = asRecord(value);
  if (!Object.keys(raw).length) return null;

  const context: RoteAgentClientContext = {
    nowIso: sanitizeString(raw.nowIso, 64),
    localDate: sanitizeString(raw.localDate, 32),
    localDateTime: sanitizeString(raw.localDateTime, 64),
    timeZone: sanitizeString(raw.timeZone, 80),
    utcOffsetMinutes: sanitizeUtcOffsetMinutes(raw.utcOffsetMinutes),
    locale: sanitizeString(raw.locale, 32),
    calendar: sanitizeString(raw.calendar, 32),
  };

  return Object.values(context).some((item) => item !== undefined) ? context : null;
}

class ClientSourceCollector {
  private sourceKeys: string[];
  private sourcesByKey = new Map<string, SemanticSearchResult>();

  constructor(sourceKeys: unknown) {
    this.sourceKeys = Array.isArray(sourceKeys)
      ? Array.from(
          new Set(
            sourceKeys
              .filter((key): key is string => typeof key === 'string')
              .map((key) => key.trim())
              .filter(Boolean)
          )
        ).slice(0, 500)
      : [];
  }

  register(sources: SemanticSearchResult[]): RoteAgentSourceRegistration[] {
    return sources.map((source) => {
      const key = sourceKey(source);
      let index = this.sourceKeys.indexOf(key);
      if (index === -1) {
        this.sourceKeys.push(key);
        index = this.sourceKeys.length - 1;
      }
      this.sourcesByKey.set(key, source);
      return { index: index + 1, source };
    });
  }

  list(): SemanticSearchResult[] {
    return Array.from(this.sourcesByKey.values());
  }

  keys(): string[] {
    return this.sourceKeys.slice(0, 500);
  }
}

function sanitizeRequest(value: unknown): RoteAgentRequest {
  const request = value && typeof value === 'object' ? (value as Record<string, any>) : {};
  const message = typeof request.message === 'string' ? request.message.trim() : '';
  if (!message) throw new Error('Message is required');

  return {
    message,
    mode:
      request.mode === 'review' || request.mode === 'organize' || request.mode === 'chat'
        ? request.mode
        : 'chat',
    history: Array.isArray(request.history)
      ? request.history
          .filter(
            (item: any) =>
              (item?.role === 'user' || item?.role === 'assistant') &&
              typeof item?.content === 'string'
          )
          .slice(-8)
      : undefined,
    state: request.state,
    selectedContext: request.selectedContext,
    limit: Number.isFinite(request.limit) ? Number(request.limit) : undefined,
    previousPlan: request.previousPlan,
    excludeIds: Array.isArray(request.excludeIds)
      ? request.excludeIds
          .filter((id: unknown): id is string => typeof id === 'string')
          .slice(0, 500)
      : undefined,
    pendingPlan: request.pendingPlan,
    clarificationAnswer:
      typeof request.clarificationAnswer === 'string' ? request.clarificationAnswer : undefined,
    clientContext: sanitizeClientContext(request.clientContext),
  };
}

function sanitizeState(value: unknown): RoteAgentClientState {
  const state = value && typeof value === 'object' ? (value as Record<string, any>) : {};
  return {
    conversationId:
      typeof state.conversationId === 'string' ? state.conversationId.slice(0, 200) : undefined,
    previousPlan: state.previousPlan || null,
    seenSourceIds: Array.isArray(state.seenSourceIds)
      ? state.seenSourceIds
          .filter((id: unknown): id is string => typeof id === 'string')
          .slice(0, 500)
      : [],
    selectedContext: state.selectedContext || null,
    clientContext: sanitizeClientContext(state.clientContext),
    stateVersion: Number.isFinite(state.stateVersion) ? Number(state.stateVersion) : 1,
  };
}

export async function executeClientRoteTool(params: {
  userId: string;
  config: AiConfig;
  toolName: unknown;
  arguments: unknown;
  request: unknown;
  state: unknown;
  sourceKeys: unknown;
}) {
  const toolName = typeof params.toolName === 'string' ? params.toolName.trim() : '';
  const tool = getNativeRoteTools().find(
    (candidate) => candidate.definition.function.name === toolName
  );
  if (!tool) throw new Error('Unknown Rote AI tool');

  const request = sanitizeRequest(params.request);
  const state = sanitizeState(params.state);
  if (!state.clientContext && request.clientContext) {
    state.clientContext = request.clientContext;
  }
  const collector = new ClientSourceCollector(params.sourceKeys);
  const call: ChatToolCall = {
    id: `client_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    type: 'function',
    function: {
      name: toolName,
      arguments: JSON.stringify(params.arguments ?? {}),
    },
  };
  const ctx: RoteAgentContext = {
    userId: params.userId,
    requestId: call.id,
    request,
    config: params.config,
    mode: request.mode || 'chat',
    policy: DEFAULT_AGENT_POLICY,
    state,
    emit: () => {},
    registerSources: (sources) => collector.register(sources),
    getSources: () => collector.list(),
  };

  const result = await tool.execute(params.arguments ?? {}, ctx, call);
  if (result.statePatch) Object.assign(state, result.statePatch);

  return {
    ...result,
    state,
    sourceKeys: collector.keys(),
  };
}
