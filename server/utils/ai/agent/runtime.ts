import {
  createChatCompletionStreamParts,
  createChatCompletionWithTools,
  type ChatMessage,
  type ChatToolCall,
} from '../client';
import { logAiTokenUsage } from '../../dbMethods';
import { buildFinalAnswerInstruction, buildRoteAgentSystemPrompt } from './prompt';
import { getNativeRoteTools } from './tools';
import {
  AgentToolCallingUnavailableError,
  DEFAULT_AGENT_POLICY,
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
    lastSources: Array.isArray(state.lastSources) ? state.lastSources.slice(0, 30) : [],
    selectedContext: state.selectedContext || request.selectedContext || null,
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
  message: string,
  task: () => Promise<T>
): Promise<T> {
  await emit({ type: 'progress', phase, message });
  const timer = setInterval(() => {
    void Promise.resolve(emit({ type: 'heartbeat', phase, message })).catch(() => {});
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

function buildInitialMessages(request: RoteAgentRequest): ChatMessage[] {
  const mode = request.mode || 'chat';
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: buildRoteAgentSystemPrompt(mode),
    },
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

async function emitText(emit: RoteAgentEmitter, text: string): Promise<boolean> {
  const clean = text.trim();
  if (!clean) return false;
  const chunkSize = 120;
  for (let index = 0; index < clean.length; index += chunkSize) {
    await emit({ type: 'delta', text: clean.slice(index, index + chunkSize) });
  }
  return true;
}

async function streamFinalAnswer(ctx: RoteAgentContext, messages: ChatMessage[]): Promise<boolean> {
  await ctx.emit({ type: 'progress', phase: 'answering', message: '正在组织回答' });
  let emittedText = false;
  let lastUsage: any = null;

  for await (const part of createChatCompletionStreamParts(ctx.config.chat, messages, {
    enableThinking: true,
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
    await ctx.emit({ type: 'usage', usage: lastUsage });
  }

  return emittedText;
}

function fallbackAnswer(sources: SemanticSearchResult[]): string {
  if (sources.length) {
    return 'I found related Rote memory, but the model did not return a usable answer. Please try again or narrow the scope.';
  }
  return 'No matching Rote memory was found for this question, so I cannot answer from your notes yet.';
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

  const messages = buildInitialMessages(request);
  let toolCallCount = 0;
  let emittedText = false;

  await params.emit({ type: 'run_started', runId });
  await params.emit({ type: 'progress', phase: 'understanding', message: '正在理解问题' });

  for (let step = 0; step < policy.maxIterations; step += 1) {
    const phase: RoteAgentPhase = step === 0 ? 'planning' : 'tool_calling';
    let assistantMessage: ChatMessage;
    try {
      const response = await emitWithHeartbeat(
        params.emit,
        policy,
        phase,
        step === 0 ? '正在判断是否需要查询 Rote' : '正在判断是否需要补查',
        () =>
          createChatCompletionWithTools(
            params.config.chat,
            messages,
            tools.map((tool) => tool.definition),
            { temperature: 0.2, enableThinking: true }
          )
      );
      assistantMessage = response.message;
      if (response.usage) {
        await logChatUsage(params.userId, params.config.chat.model, response.usage);
        await params.emit({ type: 'usage', usage: response.usage });
      }
    } catch (error: any) {
      if (step === 0 && isLikelyToolUnsupportedError(error)) {
        throw new AgentToolCallingUnavailableError(error.message || 'Tool calling is unavailable');
      }
      throw error;
    }

    const toolCalls = assistantMessage.tool_calls || [];
    if (!toolCalls.length) {
      emittedText = await emitText(params.emit, assistantMessage.content || '');
      break;
    }

    messages.push({
      role: 'assistant',
      content: assistantMessage.content || null,
      tool_calls: toolCalls,
    });

    for (const toolCall of toolCalls) {
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

      if (!tool) {
        const errorContent = JSON.stringify({
          status: 'error',
          message: `Unknown tool: ${toolCall.function.name}`,
        });
        messages.push({ role: 'tool', tool_call_id: toolCall.id, content: errorContent });
        await params.emit({
          type: 'tool_finished',
          toolName: toolCall.function.name,
          summary: 'Unknown tool',
        });
        continue;
      }

      const result = await emitWithHeartbeat(
        params.emit,
        policy,
        'tool_calling',
        `正在执行 ${toolCall.function.name}`,
        () => tool.execute(args, ctx, toolCall)
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
        summary: result.observations.join(' '),
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

  if (!emittedText) {
    messages.push({ role: 'user', content: buildFinalAnswerInstruction() });
    emittedText = await streamFinalAnswer(ctx, messages);
  }

  if (!emittedText) {
    await params.emit({ type: 'delta', text: fallbackAnswer(ctx.getSources()) });
  }

  await params.emit({
    type: 'state_patch',
    state: {
      seenSourceIds: ctx.state.seenSourceIds,
      previousPlan: ctx.state.previousPlan,
      lastSources: ctx.getSources(),
    },
  });
  await params.emit({ type: 'done' });
}

export { isAgentToolCallingUnavailableError, type RoteAgentStreamEvent } from './types';
