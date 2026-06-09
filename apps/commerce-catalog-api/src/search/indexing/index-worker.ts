import { SearchIndexJobService, type SearchIndexJob } from './index-job-service';

export type SearchIndexJobHandler = {
  handle(job: SearchIndexJob): Promise<void>;
  handleBatch?(jobs: SearchIndexJob[]): Promise<Set<string>>;
};

export type SearchIndexWorkerRunResult = {
  claimedCount: number;
  completedCount: number;
  failedCount: number;
};

export class SearchIndexWorker {
  constructor(
    private readonly jobs: SearchIndexJobService,
    private readonly handler: SearchIndexJobHandler,
  ) {}

  async runBatch(input: {
    catalogId?: string;
    limit?: number;
    includeEmbeddingRefresh?: boolean;
    retryDelayMs?: number;
    retryMaxDelayMs?: number;
    retryJitterRatio?: number;
    jobDelayMs?: number;
    concurrency?: number;
  } = {}): Promise<SearchIndexWorkerRunResult> {
    const jobs = await this.jobs.claimPending({
      catalogId: input.catalogId,
      limit: input.limit,
      includeEmbeddingRefresh: input.includeEmbeddingRefresh,
    });

    let completedCount = 0;
    let failedCount = 0;
    const concurrency = Math.max(1, Math.trunc(input.concurrency ?? 1));

    const processJob = async (job: SearchIndexJob) => {
      if (batchCompletedJobIds.has(job.id)) return;
      try {
        await this.handler.handle(job);
        await this.jobs.markCompleted(job.id);
        completedCount += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.jobs.failJob(job, message, {
          baseDelayMs: input.retryDelayMs,
          maxDelayMs: input.retryMaxDelayMs,
          jitterRatio: input.retryJitterRatio,
        });
        failedCount += 1;
      }
      if (input.jobDelayMs && input.jobDelayMs > 0) {
        await sleep(input.jobDelayMs);
      }
    };

    const batchCompletedJobIds = this.handler.handleBatch
      ? await this.handler.handleBatch(jobs)
      : new Set<string>();
    if (batchCompletedJobIds.size > 0) {
      await this.jobs.markCompletedMany([...batchCompletedJobIds]);
      completedCount += batchCompletedJobIds.size;
    }

    for (let offset = 0; offset < jobs.length; offset += concurrency) {
      await Promise.all(jobs.slice(offset, offset + concurrency).map(processJob));
    }

    return {
      claimedCount: jobs.length,
      completedCount,
      failedCount,
    };
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
