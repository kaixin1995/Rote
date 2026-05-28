import { processPendingEmbeddingJobs } from '../dbMethods/ai';

let workerStarted = false;

export function startEmbeddingWorker(): void {
  if (workerStarted) return;
  workerStarted = true;

  setInterval(() => {
    void processPendingEmbeddingJobs().catch((error) => {
      console.error('Embedding worker failed:', error);
    });
  }, 30_000);
}
