import type { AppConfig } from '@ocp-catalog/config';
import type { Db } from '@ocp-catalog/db';
import { schema } from '@ocp-catalog/db';
import { newId } from '@ocp-catalog/shared';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  buildSearchDocumentEmbeddingText,
  hashEmbeddingText,
  type SearchEmbeddingService,
} from './search-embedding-service';

const BATCH_EMBEDDINGS_ENDPOINT = '/v1/embeddings';
const OPENAI_BATCH_REQUEST_LIMIT = 50_000;

type OpenAIBatchStatus =
  | 'validating'
  | 'failed'
  | 'in_progress'
  | 'finalizing'
  | 'completed'
  | 'expired'
  | 'cancelling'
  | 'cancelled';

type OpenAIBatch = {
  id: string;
  status: OpenAIBatchStatus;
  input_file_id?: string | null;
  output_file_id?: string | null;
  error_file_id?: string | null;
  request_counts?: {
    total?: number;
    completed?: number;
    failed?: number;
  };
  errors?: unknown;
};

type OpenAIBatchOutputLine = {
  custom_id?: string;
  response?: {
    status_code?: number;
    body?: {
      model?: string;
      data?: Array<{
        embedding?: unknown;
      }>;
    };
  };
  error?: unknown;
};

type BatchBackfillJob = typeof schema.catalogEmbeddingBatchJobs.$inferSelect;
type SearchDocument = typeof schema.catalogSearchDocuments.$inferSelect;

export class OpenAIEmbeddingBatchBackfillService {
  private readonly client: OpenAIBatchClient;

  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly embeddingService: SearchEmbeddingService,
  ) {
    this.client = new OpenAIBatchClient({
      apiKey: config.OPENAI_API_KEY,
      baseUrl: config.OPENAI_BASE_URL,
      timeoutMs: config.OPENAI_TIMEOUT_MS,
    });
  }

  async submit(options: {
    limit?: number;
    providerId?: string;
    dryRun?: boolean;
  } = {}) {
    this.assertOpenAIConfigured();
    const limit = Math.min(options.limit ?? OPENAI_BATCH_REQUEST_LIMIT, OPENAI_BATCH_REQUEST_LIMIT);
    const candidates = await this.loadCandidates({
      limit,
      providerId: options.providerId,
    });

    const requests = candidates
      .map((document) => this.toBatchRequest(document))
      .filter((request): request is BatchEmbeddingRequest => request !== null);

    const inputTextChars = requests.reduce((sum, request) => sum + request.body.input.length, 0);
    if (options.dryRun) {
      return {
        status: 'dry_run' as const,
        requestedCount: requests.length,
        inputTextChars,
        sampleCustomIds: requests.slice(0, 5).map((request) => request.custom_id),
      };
    }
    if (requests.length === 0) {
      return {
        status: 'empty' as const,
        requestedCount: 0,
        inputTextChars: 0,
      };
    }

    const jobId = newId('embbatch');
    const jsonl = requests.map((request) => JSON.stringify(request)).join('\n') + '\n';
    const inputFile = await this.client.uploadBatchInput(`${jobId}.jsonl`, jsonl);
    const batch = await this.client.createBatch({
      inputFileId: inputFile.id,
      metadata: {
        job_id: jobId,
        catalog_id: this.config.CATALOG_ID,
        embedding_model: this.config.EMBEDDING_MODEL,
        embedding_dimension: String(this.config.EMBEDDING_DIMENSION),
      },
    });
    const completedPendingRefreshJobs = await this.embeddingServiceJobsMarkCompleted(
      requests.map((request) => request.custom_id),
    );

    const [row] = await this.db.insert(schema.catalogEmbeddingBatchJobs).values({
      id: jobId,
      catalogId: this.config.CATALOG_ID,
      status: normalizeBatchStatus(batch.status),
      openaiBatchId: batch.id,
      inputFileId: inputFile.id,
      outputFileId: batch.output_file_id ?? null,
      errorFileId: batch.error_file_id ?? null,
      embeddingProvider: 'openai',
      embeddingModel: this.embeddingModel,
      embeddingDimension: this.config.EMBEDDING_DIMENSION,
      requestedCount: requests.length,
      completedCount: batch.request_counts?.completed ?? 0,
      failedCount: batch.request_counts?.failed ?? 0,
      inputTextChars,
      metadata: {
        provider_id: options.providerId ?? null,
        completed_pending_refresh_jobs: completedPendingRefreshJobs,
      },
      submittedAt: new Date(),
    }).returning();

    return {
      status: 'submitted' as const,
      job: row,
      batch,
    };
  }

  async poll(options: { jobId?: string } = {}) {
    this.assertOpenAIConfigured();
    const jobs = await this.loadPollableJobs(options.jobId);
    const updated: BatchBackfillJob[] = [];
    for (const job of jobs) {
      if (!job.openaiBatchId) continue;
      const batch = await this.client.getBatch(job.openaiBatchId);
      updated.push(await this.updateJobFromBatch(job, batch));
    }
    return updated;
  }

  async ingest(options: { jobId?: string; limit?: number } = {}) {
    this.assertOpenAIConfigured();
    const jobs = await this.loadIngestibleJobs(options.jobId);
    const results: Array<{
      jobId: string;
      ingestedCount: number;
      failedCount: number;
      skippedCount: number;
    }> = [];

    for (const job of jobs) {
      if (!job.outputFileId) continue;
      await this.markJobIngesting(job.id);
      const content = await this.client.downloadFileContent(job.outputFileId);
      const result = await this.ingestOutput(job, content, options.limit);
      await this.db.update(schema.catalogEmbeddingBatchJobs)
        .set({
          status: 'ingested',
          ingestedCount: job.ingestedCount + result.ingestedCount,
          failedCount: job.failedCount + result.failedCount,
          ingestedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.catalogEmbeddingBatchJobs.id, job.id));
      results.push({ jobId: job.id, ...result });
    }

    return results;
  }

  private async loadCandidates(options: { limit: number; providerId?: string }) {
    const filters = [
      eq(schema.catalogSearchDocuments.catalogId, this.config.CATALOG_ID),
      eq(schema.catalogSearchDocuments.documentStatus, 'active'),
    ];
    if (options.providerId) {
      filters.push(eq(schema.catalogSearchDocuments.providerId, options.providerId));
    }

    return this.db
      .select({
        document: schema.catalogSearchDocuments,
      })
      .from(schema.catalogSearchDocuments)
      .leftJoin(
        schema.catalogSearchEmbeddings,
        and(
          eq(schema.catalogSearchEmbeddings.catalogSearchDocumentId, schema.catalogSearchDocuments.id),
          eq(schema.catalogSearchEmbeddings.embeddingModel, this.embeddingModel),
          eq(schema.catalogSearchEmbeddings.embeddingDimension, this.config.EMBEDDING_DIMENSION),
          eq(schema.catalogSearchEmbeddings.status, 'ready'),
        ),
      )
      .where(and(
        ...filters,
        isNull(schema.catalogSearchEmbeddings.id),
      ))
      .orderBy(asc(schema.catalogSearchDocuments.updatedAt))
      .limit(options.limit)
      .then((rows) => rows.map((row) => row.document));
  }

  private async embeddingServiceJobsMarkCompleted(documentIds: string[]) {
    if (documentIds.length === 0) return 0;
    const rows = await this.db.execute(sql`
      update catalog_search_index_jobs
      set
        status = 'completed',
        finished_at = now(),
        updated_at = now()
      where catalog_id = ${this.config.CATALOG_ID}
        and job_type = 'refresh_embedding'
        and status = 'pending'
        and payload->>'search_document_id' = any(${documentIds}::text[])
      returning id
    `);

    return rows.length;
  }

  private toBatchRequest(document: SearchDocument): BatchEmbeddingRequest | null {
    const embeddingText = buildSearchDocumentEmbeddingText(document);
    if (!embeddingText) return null;
    return {
      custom_id: document.id,
      method: 'POST',
      url: BATCH_EMBEDDINGS_ENDPOINT,
      body: {
        model: this.embeddingModel,
        input: truncateInput(embeddingText, this.config.OPENAI_EMBEDDING_MAX_INPUT_CHARS),
        dimensions: this.config.EMBEDDING_DIMENSION,
      },
    };
  }

  private async loadPollableJobs(jobId?: string) {
    const statuses = ['submitted', 'validating', 'in_progress', 'finalizing'] as const;
    return this.db
      .select()
      .from(schema.catalogEmbeddingBatchJobs)
      .where(and(
        eq(schema.catalogEmbeddingBatchJobs.catalogId, this.config.CATALOG_ID),
        jobId ? eq(schema.catalogEmbeddingBatchJobs.id, jobId) : inArray(schema.catalogEmbeddingBatchJobs.status, statuses),
      ))
      .orderBy(asc(schema.catalogEmbeddingBatchJobs.createdAt))
      .limit(jobId ? 1 : 25);
  }

  private async loadIngestibleJobs(jobId?: string) {
    return this.db
      .select()
      .from(schema.catalogEmbeddingBatchJobs)
      .where(and(
        eq(schema.catalogEmbeddingBatchJobs.catalogId, this.config.CATALOG_ID),
        jobId ? eq(schema.catalogEmbeddingBatchJobs.id, jobId) : eq(schema.catalogEmbeddingBatchJobs.status, 'completed'),
      ))
      .orderBy(asc(schema.catalogEmbeddingBatchJobs.createdAt))
      .limit(jobId ? 1 : 5);
  }

  private async updateJobFromBatch(job: BatchBackfillJob, batch: OpenAIBatch) {
    const [row] = await this.db.update(schema.catalogEmbeddingBatchJobs)
      .set({
        status: normalizeBatchStatus(batch.status),
        outputFileId: batch.output_file_id ?? job.outputFileId,
        errorFileId: batch.error_file_id ?? job.errorFileId,
        completedCount: batch.request_counts?.completed ?? job.completedCount,
        failedCount: batch.request_counts?.failed ?? job.failedCount,
        error: batch.errors ? JSON.stringify(batch.errors).slice(0, 4000) : job.error,
        completedAt: batch.status === 'completed' ? new Date() : job.completedAt,
        updatedAt: new Date(),
      })
      .where(eq(schema.catalogEmbeddingBatchJobs.id, job.id))
      .returning();
    return row;
  }

  private async markJobIngesting(jobId: string) {
    await this.db.update(schema.catalogEmbeddingBatchJobs)
      .set({ status: 'ingesting', updatedAt: new Date() })
      .where(eq(schema.catalogEmbeddingBatchJobs.id, jobId));
  }

  private async ingestOutput(job: BatchBackfillJob, content: string, limit?: number) {
    let ingestedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    const processedDocumentIds: string[] = [];
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      if (limit && ingestedCount + failedCount + skippedCount >= limit) break;
      const parsed = JSON.parse(line) as OpenAIBatchOutputLine;
      const documentId = parsed.custom_id;
      if (!documentId) {
        skippedCount += 1;
        continue;
      }
      const document = await this.embeddingService.loadSearchDocument(documentId);
      if (!document || document.catalogId !== job.catalogId) {
        skippedCount += 1;
        continue;
      }
      const embeddingText = buildSearchDocumentEmbeddingText(document);
      const embeddingTextHash = hashEmbeddingText(embeddingText);
      const vector = parsed.response?.body?.data?.[0]?.embedding;
      if (parsed.error || parsed.response?.status_code !== 200 || !isNumberVector(vector)) {
        await this.embeddingService.recordEmbeddingResult(document, {
          embeddingText,
          embeddingTextHash,
          embeddingDimension: job.embeddingDimension,
          embeddingVector: [],
          status: 'failed',
          error: JSON.stringify(parsed.error ?? parsed.response ?? 'unknown batch embedding error').slice(0, 4000),
        });
        failedCount += 1;
        processedDocumentIds.push(document.id);
        continue;
      }

      await this.embeddingService.recordEmbeddingResult(document, {
        embeddingText,
        embeddingTextHash,
        embeddingDimension: vector.length,
        embeddingVector: vector,
        status: 'ready',
        error: null,
      });
      ingestedCount += 1;
      processedDocumentIds.push(document.id);
    }
    await this.embeddingServiceJobsMarkCompleted(processedDocumentIds);
    return { ingestedCount, failedCount, skippedCount };
  }

  private assertOpenAIConfigured() {
    if (!this.config.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required for OpenAI Batch embedding backfill');
    }
    if (!this.embeddingModel.startsWith('text-embedding-')) {
      throw new Error(`OpenAI Batch embedding backfill requires an OpenAI embedding model, got ${this.embeddingModel}`);
    }
  }

  private get embeddingModel() {
    return this.config.EMBEDDING_MODEL === 'local-hash-v1'
      ? 'text-embedding-3-small'
      : this.config.EMBEDDING_MODEL;
  }
}

type BatchEmbeddingRequest = {
  custom_id: string;
  method: 'POST';
  url: typeof BATCH_EMBEDDINGS_ENDPOINT;
  body: {
    model: string;
    input: string;
    dimensions: number;
  };
};

class OpenAIBatchClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: { apiKey: string; baseUrl: string; timeoutMs: number }) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs;
  }

  async uploadBatchInput(filename: string, content: string): Promise<{ id: string }> {
    const form = new FormData();
    form.append('purpose', 'batch');
    form.append('file', new Blob([content], { type: 'application/jsonl' }), filename);
    return this.request('/files', {
      method: 'POST',
      body: form,
    });
  }

  async createBatch(input: { inputFileId: string; metadata: Record<string, string> }): Promise<OpenAIBatch> {
    return this.request('/batches', {
      method: 'POST',
      json: {
        input_file_id: input.inputFileId,
        endpoint: BATCH_EMBEDDINGS_ENDPOINT,
        completion_window: '24h',
        metadata: input.metadata,
      },
    });
  }

  async getBatch(batchId: string): Promise<OpenAIBatch> {
    return this.request(`/batches/${encodeURIComponent(batchId)}`, { method: 'GET' });
  }

  async downloadFileContent(fileId: string): Promise<string> {
    return this.request(`/files/${encodeURIComponent(fileId)}/content`, {
      method: 'GET',
      text: true,
    });
  }

  private async request<T = unknown>(path: string, options: {
    method: 'GET' | 'POST';
    json?: unknown;
    body?: BodyInit;
    text?: boolean;
  }): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = {
        authorization: `Bearer ${this.apiKey}`,
      };
      let body = options.body;
      if (options.json !== undefined) {
        headers['content-type'] = 'application/json';
        body = JSON.stringify(options.json);
      }
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method,
        headers,
        body,
        signal: controller.signal,
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(`OpenAI ${options.method} ${path} failed: ${response.status} ${response.statusText} ${message}`);
      }
      return options.text ? await response.text() as T : await response.json() as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function normalizeBatchStatus(status: OpenAIBatchStatus | string): typeof schema.catalogEmbeddingBatchJobs.$inferInsert.status {
  if (status === 'cancelling') return 'cancelled';
  if (
    status === 'validating'
    || status === 'failed'
    || status === 'in_progress'
    || status === 'finalizing'
    || status === 'completed'
    || status === 'expired'
    || status === 'cancelled'
  ) {
    return status;
  }
  return 'submitted';
}

function truncateInput(input: string, maxInputChars: number) {
  if (input.length <= maxInputChars) return input;
  return input.slice(0, maxInputChars);
}

function isNumberVector(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'number' && Number.isFinite(item));
}
