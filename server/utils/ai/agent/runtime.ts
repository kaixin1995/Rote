import {
  createChatCompletionStreamParts,
  createChatCompletionWithToolsStreaming,
  type ChatMessage,
  type ChatToolCall,
} from '../client';
import { logAiTokenUsage } from '../../dbMethods';
import { buildFinalAnswerInstruction, buildRoteAgentSystemPrompt } from './prompt';
import { getNativeRoteTools } from './tools';
import {
  AgentToolCallingUnavailableError,
  DEFAULT_AGENT_POLICY,
  type RoteAgentClientContext,
  type RoteAgentClientState,
  type RoteAgentContext,
  type RoteAgentEmitter,
  type RoteAgentPhase,
  type RoteAgentPolicy,
  type RoteAgentRequest,
  type RoteAgentSourceRegistration,
} from './types';
import type { SemanticSearchResult } from '../../dbMethods/ai';

function createRunId(): string {
  return `agent_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

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

class SourceCollector {
  private sources: SemanticSearchResult[] = [];
  private indexByKey = new Map<string, number>();

  register(sources: SemanticSearchResult[]): RoteAgentSourceRegistration[] {
    const registrations: RoteAgentSourceRegistration[] = [];
    sources.forEach((source) => {
      const key = sourceKey(source);
      let index = this.indexByKey.get(key);
      if (!index) {
        this.sources.push(source);
        index = this.sources.length;
        this.indexByKey.set(key, index);
      } else {
        const existing = this.sources[index - 1];
        if (existing && source.similarity > existing.similarity) {
          this.sources[index - 1] = source;
        }
      }
      registrations.push({ index, source: this.sources[index - 1] || source });
    });
    return registrations;
  }

  list(): SemanticSearchResult[] {
    return this.sources;
  }
}

function sanitizeAgentState(request: RoteAgentRequest): RoteAgentClientState {
  const state = request.state && typeof request.state === 'object' ? request.state : {};
  const seenSourceIds = Array.isArray(state.seenSourceIds)
    ? state.seenSourceIds.filter((id) => typeof id === 'string').slice(0, 500)
    : request.excludeIds?.filter((id) => typeof id === 'string').slice(0, 500) || [];

  return {
    conversationId: typeof state.conversationId === 'string' ? state.conversationId : undefined,
    previousPlan: state.previousPlan || request.previousPlan || null,
    seenSourceIds,
    selectedContext: state.selectedContext || request.selectedContext || null,
    clientContext:
      sanitizeClientContext(state.clientContext) || sanitizeClientContext(request.clientContext),
    stateVersion: Number.isFinite(state.stateVersion) ? state.stateVersion : 1,
  };
}

function parseToolArguments(call: ChatToolCall): unknown {
  try {
    return call.function.arguments ? JSON.parse(call.function.arguments) : {};
  } catch {
    return {};
  }
}

function buildToolRegistryCorrection(unknownToolNames: string[], availableToolNames: string[]) {
  return [
    `The requested tool name is not registered: ${unknownToolNames.join(', ')}.`,
    `Available tools are: ${availableToolNames.join(', ')}.`,
    'Choose one of the registered tools exactly as named, or answer without tools if no tool is needed.',
  ].join('\n');
}

function isLikelyToolUnsupportedError(error: any): boolean {
  const message = String(error?.message || error || '').toLowerCase();
  return (
    message.includes('tool') ||
    message.includes('function call') ||
    message.includes('function_call') ||
    message.includes('tool_choice') ||
    message.includes('tools is not') ||
    message.includes('unsupported parameter')
  );
}

async function emitWithHeartbeat<T>(
  emit: RoteAgentEmitter,
  policy: RoteAgentPolicy,
  phase: RoteAgentPhase,
  task: () => Promise<T>
): Promise<T> {
  await emit({ type: 'progress', phase });
  let heartbeatSeq = 0;
  const timer = setInterval(() => {
    heartbeatSeq += 1;
    void Promise.resolve(
      emit({ type: 'heartbeat', phase, seq: heartbeatSeq, timestamp: new Date().toISOString() })
    ).catch(() => {});
  }, policy.heartbeatMs);

  try {
    return await task();
  } finally {
    clearInterval(timer);
  }
}

async function logChatUsage(userId: string, model: string, usage: any): Promise<void> {
  if (!usage) return;
  await logAiTokenUsage({
    userid: userId,
    model,
    type: 'chat',
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  });
}

function buildRequestTimeContextMessage(state: RoteAgentClientState): ChatMessage {
  const clientContext = state.clientContext;
  const lines = [
    '## Current request time context',
    `Server now (UTC): ${new Date().toISOString()}`,
  ];

  if (clientContext) {
    if (clientContext.nowIso) lines.push(`Client now (UTC): ${clientContext.nowIso}`);
    if (clientContext.localDate) lines.push(`Client local date: ${clientContext.localDate}`);
    if (clientContext.localDateTime) {
      lines.push(`Client local date/time: ${clientContext.localDateTime}`);
    }
    if (clientContext.timeZone) lines.push(`Client time zone: ${clientContext.timeZone}`);
    if (typeof clientContext.utcOffsetMinutes === 'number') {
      lines.push(`Client UTC offset minutes: ${clientContext.utcOffsetMinutes}`);
    }
    if (clientContext.locale) lines.push(`Client locale: ${clientContext.locale}`);
    if (clientContext.calendar) lines.push(`Client calendar: ${clientContext.calendar}`);
  } else {
    lines.push(
      'Client time context was not supplied; use server now and Asia/Shanghai for Rote date ranges.'
    );
  }

  lines.push(
    'Resolve relative date phrases such as today, yesterday, this month, last month, 最近, 本月, and 上月 using this context.',
    'When calling rote_search_notes for a relative date phrase, pass the phrase as timeExpression instead of inventing absolute from/to dates.',
    'Use from/to only when the user explicitly provides absolute dates.'
  );

  return { role: 'system', content: lines.join('\n') };
}

function buildInitialMessages(
  request: RoteAgentRequest,
  state: RoteAgentClientState
): ChatMessage[] {
  const mode = request.mode || 'chat';
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: buildRoteAgentSystemPrompt(mode),
    },
    buildRequestTimeContextMessage(state),
  ];

  if (request.history?.length) {
    messages.push(
      ...request.history.slice(-8).map((message) => ({
        role: message.role,
        content: message.content,
      }))
    );
  }

  messages.push({ role: 'user', content: request.message });
  return messages;
}

async function streamFinalAnswer(ctx: RoteAgentContext, messages: ChatMessage[]): Promise<boolean> {
  await ctx.emit({ type: 'progress', phase: 'answering' });
  let emittedText = false;
  let lastUsage: any = null;

  for await (const part of createChatCompletionStreamParts(ctx.config.chat, messages, {
    enableThinking: ctx.request.enableThinking === true,
  })) {
    if (part.type === 'reasoning') {
      await ctx.emit({ type: 'thinking', phase: 'answer', text: part.text });
    } else if (part.type === 'usage') {
      lastUsage = part.usage;
    } else if (part.type === 'content') {
      emittedText = true;
      await ctx.emit({ type: 'delta', text: part.text });
    }
  }

  if (lastUsage) {
    await logChatUsage(ctx.userId, ctx.config.chat.model, lastUsage);
    await ctx.emit({ type: 'usage', phase: 'answer', usage: lastUsage });
  }

  return emittedText;
}

export async function runRoteAgentStream(params: {
  userId: string;
  request: RoteAgentRequest;
  config: RoteAgentContext['config'];
  emit: RoteAgentEmitter;
  policy?: Partial<RoteAgentPolicy>;
}): Promise<void> {
  const request = params.request;
  const runId = createRunId();
  const policy = { ...DEFAULT_AGENT_POLICY, ...(params.policy || {}) };
  const tools = getNativeRoteTools();
  const toolByName = new Map(tools.map((tool) => [tool.definition.function.name, tool]));
  const sourceCollector = new SourceCollector();
  const state = sanitizeAgentState(request);
  const mode = request.mode || 'chat';
  const ctx: RoteAgentContext = {
    userId: params.userId,
    requestId: runId,
    request,
    config: params.config,
    mode,
    policy,
    state,
    emit: params.emit,
    registerSources: (sources) => sourceCollector.register(sources),
    getSources: () => sourceCollector.list(),
  };

  const messages = buildInitialMessages(request, state);
  let toolCallCount = 0;
  let hasFinalAnswer = false;

  await params.emit({ type: 'run_started', runId });
  await params.emit({ type: 'progress', phase: 'understanding' });

  for (let step = 0; step < policy.maxIterations; step += 1) {
    const phase: RoteAgentPhase = step === 0 ? 'planning' : 'tool_calling';
    let assistantMessage: ChatMessage;
    let responseUsage: Awaited<ReturnType<typeof createChatCompletionWithToolsStreaming>>['usage'];
    try {
      const response = await emitWithHeartbeat(params.emit, policy, phase, () =>
        createChatCompletionWithToolsStreaming(
          params.config.chat,
          messages,
          tools.map((tool) => tool.definition),
          {
            temperature: 0.2,
            enableThinking: request.enableThinking === true,
            onReasoning: (text) =>
              params.emit({
                type: 'thinking',
                phase: step === 0 ? 'route_decision' : 'evidence_decision',
                text,
              }),
            onContent: async (text) => {
              await params.emit({ type: 'delta', text });
            },
          }
        )
      );
      assistantMessage = response.message;
      responseUsage = response.usage;
      if (response.usage) {
        await logChatUsage(params.userId, params.config.chat.model, response.usage);
      }
    } catch (error: any) {
      if (step === 0 && isLikelyToolUnsupportedError(error)) {
        throw new AgentToolCallingUnavailableError(error.message || 'Tool calling is unavailable');
      }
      throw error;
    }

    const toolCalls = assistantMessage.tool_calls || [];
    if (!toolCalls.length) {
      hasFinalAnswer = !!assistantMessage.content?.trim();
      if (responseUsage) {
        await params.emit({
          type: 'usage',
          phase: hasFinalAnswer ? 'answer' : step === 0 ? 'planning' : 'tool_decision',
          usage: responseUsage,
        });
      }
      break;
    }

    if (responseUsage) {
      await params.emit({
        type: 'usage',
        phase: step === 0 ? 'planning' : 'tool_decision',
        usage: responseUsage,
      });
    }

    const validToolCalls = toolCalls.filter((toolCall) => toolByName.has(toolCall.function.name));
    const unknownToolNames = Array.from(
      new Set(
        toolCalls
          .map((toolCall) => toolCall.function.name)
          .filter((toolName) => !toolByName.has(toolName))
      )
    );

    if (unknownToolNames.length > 0) {
      messages.push({
        role: 'system',
        content: buildToolRegistryCorrection(unknownToolNames, Array.from(toolByName.keys())),
      });
    }

    if (validToolCalls.length === 0) {
      continue;
    }

    messages.push({
      role: 'assistant',
      content: assistantMessage.content || null,
      tool_calls: validToolCalls,
    });

    for (const toolCall of validToolCalls) {
      if (toolCallCount >= policy.maxToolCalls) {
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({
            status: 'skipped',
            reason: 'tool_budget_exceeded',
            message: `Tool call ${toolCall.function.name} was skipped because the agent reached the maximum tool call budget.`,
          }),
        });
        await params.emit({
          type: 'tool_finished',
          toolName: toolCall.function.name,
          summary: 'Skipped: tool budget exceeded',
        });
        continue;
      }
      toolCallCount += 1;

      const tool = toolByName.get(toolCall.function.name);
      const args = parseToolArguments(toolCall);
      await params.emit({ type: 'tool_started', toolName: toolCall.function.name, args });

      const result = await emitWithHeartbeat(params.emit, policy, 'tool_calling', () =>
        tool!.execute(args, ctx, toolCall)
      );

      if (result.plan) await params.emit({ type: 'plan', plan: result.plan });
      if (result.sources) await params.emit({ type: 'sources', sources: ctx.getSources() });
      if (result.statePatch) {
        Object.assign(ctx.state, result.statePatch);
        await params.emit({ type: 'state_patch', state: result.statePatch });
      }
      await params.emit({
        type: 'tool_finished',
        toolName: toolCall.function.name,
        summary: result.displaySummary || result.observations.join(' '),
      });

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: result.modelContent,
      });

      if (result.clarification) {
        await params.emit({
          type: 'clarification',
          question: result.clarification.question,
          pendingPlan: result.clarification.pendingPlan,
        });
        await params.emit({ type: 'done' });
        return;
      }
    }

    if (toolCallCount >= policy.maxToolCalls) break;
  }

  if (!hasFinalAnswer) {
    messages.push({ role: 'user', content: buildFinalAnswerInstruction() });
    hasFinalAnswer = await streamFinalAnswer(ctx, messages);
  }

  if (!hasFinalAnswer) {
    const errorCode =
      ctx.getSources().length > 0 ? 'error_no_answer_with_sources' : 'error_no_answer_no_sources';
    await params.emit({ type: 'error', message: errorCode });
  }

  await params.emit({
    type: 'state_patch',
    state: {
      seenSourceIds: ctx.state.seenSourceIds,
      previousPlan: ctx.state.previousPlan,
    },
  });
  await params.emit({ type: 'done' });
}

export { isAgentToolCallingUnavailableError, type RoteAgentStreamEvent } from './types';
