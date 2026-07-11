export type AiSourceType = 'rote' | 'article';
export type LifecycleScope = 'active' | 'archived' | 'all' | 'unspecified';
export type TaskStatusScope = 'open' | 'closed' | 'all' | 'unspecified';
export type AiTimeUnit = 'day' | 'week' | 'month' | 'year';
export type RetrievalSelection = 'relevance' | 'recent';
export type RetrievalDateField = 'createdAt' | 'updatedAt';

export interface NormalizedTimeRange {
  from: string;
  to: string;
  label: string;
}

export type StructuredTimeRangeType = 'absolute' | 'rolling' | 'relative_between' | 'preset';
export type StructuredTimeRangePreset = 'today' | 'yesterday' | 'this_month' | 'last_month';

export interface StructuredRelativeTimePoint {
  amount?: number;
  unit?: AiTimeUnit;
  direction?: 'ago';
}

export interface StructuredTimeRange {
  type?: StructuredTimeRangeType;
  preset?: StructuredTimeRangePreset;
  fromDate?: string;
  toDate?: string;
  amount?: number;
  unit?: AiTimeUnit;
  fromRelative?: StructuredRelativeTimePoint;
  toRelative?: StructuredRelativeTimePoint;
  label?: string;
}

export interface RetrievalScope {
  ownerId: string;
  query: string;
  tags: string[];
  excludeTags: string[];
  semanticScope: string[];
  sourceTypes: AiSourceType[];
  timeRange: NormalizedTimeRange | null;
  selection: RetrievalSelection;
  dateField: RetrievalDateField;
  lifecycleScope: LifecycleScope;
  taskStatusScope: TaskStatusScope;
  limit: number;
  cursor: string | null;
  excludeIds: string[];
}

export interface SearchRotesArgs {
  query?: string;
  tags?: string[];
  excludeTags?: string[];
  semanticScope?: string[];
  sourceTypes?: AiSourceType[];
  timeRange?: StructuredTimeRange;
  timeExpression?: string;
  from?: string;
  to?: string;
  selection?: RetrievalSelection;
  dateField?: RetrievalDateField;
  lifecycleScope?: LifecycleScope;
  taskStatusScope?: TaskStatusScope;
  limit?: number;
  cursor?: string;
}

export interface RetrievalTimeContext {
  nowIso?: string;
  localDate?: string;
  localDateTime?: string;
  timeZone?: string;
  utcOffsetMinutes?: number;
}

export interface RetrievalSnippet {
  id: string;
  sourceType: AiSourceType;
  sourceId: string;
  title?: string;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
  retrievalMode?: RetrievalSelection;
  similarity: number;
  text: string;
}

export interface RetrievalToolResult {
  canonicalizedArgs: RetrievalScope;
  resultCount: number;
  topSnippets: RetrievalSnippet[];
  cursor: string | null;
  warnings: string[];
}

export interface SearchRotesProbeResult {
  toolResult: RetrievalToolResult;
  sources: unknown[];
}

export interface PlannerDebugTrace {
  toolCalls: Array<{
    step: number;
    name: string;
    args: unknown;
  }>;
  canonicalizedArgs: RetrievalScope[];
  warnings: string[];
  probeCounts: number[];
  finishReason?: string;
  fallbackReason?: string;
  providerError?: string;
  toolError?: string;
}

export interface PlannerAgentResult {
  originalMessage: string;
  retrievalNeeded: boolean;
  scope: RetrievalScope | null;
  toolResult: RetrievalToolResult | null;
  sources: unknown[];
  clarification: { question: string; reason?: string } | null;
  debugTrace: PlannerDebugTrace;
}

export interface PlannerAgentDto {
  originalMessage: string;
  retrievalNeeded: boolean;
  scope: RetrievalScope | null;
  toolResult: RetrievalToolResult | null;
  clarification: { question: string; reason?: string } | null;
  debugTrace: PlannerDebugTrace;
}

export type SearchRotesProbeExecutor = (scope: RetrievalScope) => Promise<SearchRotesProbeResult>;
