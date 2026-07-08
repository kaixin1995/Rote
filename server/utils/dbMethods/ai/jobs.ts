export { ensurePgvectorReady, getPgvectorStatus } from './vector';
export {
  deleteEmbeddingsForOwner,
  deleteEmbeddingsForSource,
  enqueueBackfillEmbeddingJobs,
  enqueueBackfillEmbeddingJobsForOwner,
  enqueueEmbeddingJob,
  getEmbeddingJobStats,
} from './embeddingQueue';
export {
  clearAllEmbeddings,
  processPendingEmbeddingJobs,
  retryFailedEmbeddingJobs,
  setIndexingPaused,
} from './embeddingWorker';
