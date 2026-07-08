export type AiSourceType = 'rote' | 'article';
export type EmbeddingJobAction = 'upsert' | 'delete' | 'reindex';
export type EmbeddingJobStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export type {
  NormalizedTimeRange,
  PlannerAgentDto,
  PlannerAgentResult,
  RetrievalScope,
  RetrievalSnippet,
  RetrievalTimeContext,
  RetrievalToolResult,
  SearchRotesArgs,
  SearchRotesProbeResult,
} from '../../ai/retrievalPlan';

export interface SemanticSearchResult {
  id: string;
  ownerId: string;
  sourceType: AiSourceType;
  sourceId: string;
  chunkIndex: number;
  text: string;
  similarity: number;
  metadata: any;
}
