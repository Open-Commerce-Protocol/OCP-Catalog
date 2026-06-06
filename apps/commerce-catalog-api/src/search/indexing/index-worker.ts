import { SearchIndexJobService, type SearchIndexJob } from './index-job-service';

export type SearchIndexJobHandler = {
  handle(job: SearchIndexJob): Promise<void>;
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
    retryDelayMs?: number;
  } = {}): Promise<SearchIndexWorkerRunResult> {
    const jobs = await this.jobs.listPending({
      catalogId: input.catalogId,
      limit: input.limit,
    });

    let completedCount = 0;
    let failedCount = 0;

    for (const job of jobs) {
      await this.jobs.markRunning(job.id);
      try {
        await this.handler.handle(job);
        await this.jobs.markCompleted(job.id);
        completedCount += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.jobs.failJob(job, message, input.retryDelayMs);
        failedCount += 1;
      }
    }

    return {
      claimedCount: jobs.length,
      completedCount,
      failedCount,
    };
  }
}
