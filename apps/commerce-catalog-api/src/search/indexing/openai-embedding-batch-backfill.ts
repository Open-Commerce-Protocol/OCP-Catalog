import type { AppConfig } from '@ocp-catalog/config';
import type { Db } from '@ocp-catalog/db';
import { schema } from '@ocp-catalog/db';
import { newId } from '@ocp-catalog/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { readFile } from 'node:fs/promises';
import {
  buildSearchDocumentEmbeddingText,
  hashEmbeddingText,
  type SearchEmbeddingService,
} from './search-embedding-service';
import type { BulkWritableVectorIndexAdapter, VectorIndexDocument } from '../retrieval/vector-index-adapter';

const BATCH_EMBEDDINGS_ENDPOINT = '/v1/embeddings';
const OPENAI_BATCH_REQUEST_LIMIT = 50_000;
const DEFAULT_OPENAI_BATCH_REQUEST_LIMIT = 5_000;
const INGEST_CHUNK_SIZE = 250;
const ACTIVE_INGESTING_STALE_MS = 15 * 60 * 1000;
const MAX_STALE_CANDIDATE_SWEEPS = 10;

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
    const limit = Math.min(options.limit ?? DEFAULT_OPENAI_BATCH_REQUEST_LIMIT, OPENAI_BATCH_REQUEST_LIMIT);
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

  async ingest(options: { jobId?: string; limit?: number; outputFilePath?: string } = {}) {
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
      try {
        const content = options.outputFilePath
          ? await readFile(options.outputFilePath, 'utf8')
          : await this.client.downloadFileContent(job.outputFileId);
        const result = await this.ingestOutput(job, content, options.limit);
        const nextIngestedCount = result.ingestedCount;
        const nextFailedCount = result.failedCount;
        const fullyProcessed = !options.limit || nextIngestedCount + nextFailedCount >= job.requestedCount;
        await this.db.update(schema.catalogEmbeddingBatchJobs)
          .set({
            status: fullyProcessed ? 'ingested' : 'completed',
            ingestedCount: nextIngestedCount,
            failedCount: nextFailedCount,
            ingestedAt: fullyProcessed ? new Date() : job.ingestedAt,
            error: null,
            updatedAt: new Date(),
          })
          .where(eq(schema.catalogEmbeddingBatchJobs.id, job.id));
        results.push({ jobId: job.id, ...result });
      } catch (error) {
        await this.db.update(schema.catalogEmbeddingBatchJobs)
          .set({
            status: 'completed',
            error: error instanceof Error ? error.message.slice(0, 4000) : String(error).slice(0, 4000),
            updatedAt: new Date(),
          })
          .where(eq(schema.catalogEmbeddingBatchJobs.id, job.id));
        throw error;
      }
    }

    return results;
  }

  async countActiveJobs() {
    const statuses = ['submitted', 'validating', 'in_progress', 'finalizing', 'completed'] as const;
    const activeIngestingAfter = new Date(Date.now() - ACTIVE_INGESTING_STALE_MS).toISOString();
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.catalogEmbeddingBatchJobs)
      .where(and(
        eq(schema.catalogEmbeddingBatchJobs.catalogId, this.config.CATALOG_ID),
        sql`(
          ${schema.catalogEmbeddingBatchJobs.status} in (${sql.join(statuses.map((status) => sql`${status}`), sql`, `)})
          or (
            ${schema.catalogEmbeddingBatchJobs.status} = 'ingesting'
            and ${schema.catalogEmbeddingBatchJobs.updatedAt} >= ${activeIngestingAfter}::timestamptz
          )
        )`,
      ));

    return row?.count ?? 0;
  }

  private async loadCandidates(options: { limit: number; providerId?: string }) {
    const candidates: SearchDocument[] = [];
    for (let sweep = 0; sweep < MAX_STALE_CANDIDATE_SWEEPS && candidates.length < options.limit; sweep += 1) {
      const remaining = options.limit - candidates.length;
      const pendingJobRows = await this.loadPendingEmbeddingDocumentIds({
        ...options,
        limit: remaining,
      });
      const documentIds = unique(pendingJobRows.map((row) => row.documentId).filter((value): value is string => Boolean(value)));
      if (documentIds.length === 0) break;

      const existingEmbeddings = await this.loadExistingEmbeddingsByDocumentId(documentIds, this.embeddingModel);
      const readyDocumentIds = new Set(documentIds.filter((documentId) => {
        const existing = existingEmbeddings.get(documentId);
        return existing?.status === 'ready' && existing.embeddingDimension === this.config.EMBEDDING_DIMENSION;
      }));
      const readyJobIds = pendingJobRows
        .filter((row) => row.documentId && readyDocumentIds.has(row.documentId))
        .map((row) => row.jobId);
      await this.embeddingServiceJobsMarkCompletedById(readyJobIds);

      const candidateDocumentIds = documentIds.filter((documentId) => !readyDocumentIds.has(documentId));
      if (candidateDocumentIds.length === 0) continue;

      const filters = [
        eq(schema.catalogSearchDocuments.catalogId, this.config.CATALOG_ID),
        eq(schema.catalogSearchDocuments.documentStatus, 'active'),
        inArray(schema.catalogSearchDocuments.id, candidateDocumentIds),
      ];
      if (options.providerId) {
        filters.push(eq(schema.catalogSearchDocuments.providerId, options.providerId));
      }

      const documents = await this.db
        .select()
        .from(schema.catalogSearchDocuments)
        .where(and(...filters))
        .limit(remaining);
      candidates.push(...documents);
    }

    return candidates;
  }

  private async loadPendingEmbeddingDocumentIds(options: { limit: number; providerId?: string }) {
    const providerFilter = options.providerId ? sql`and provider_id = ${options.providerId}` : sql``;
    const rows = await this.db.execute(sql`
      select id as "jobId", payload->>'search_document_id' as "documentId"
      from catalog_search_index_jobs
      where catalog_id = ${this.config.CATALOG_ID}
        and job_type = 'refresh_embedding'
        and status = 'pending'
        ${providerFilter}
        and payload->>'search_document_id' is not null
      order by scheduled_at asc, created_at asc, id asc
      limit ${options.limit}
    `);
    return rows as unknown as Array<{ jobId: string; documentId: string | null }>;
  }

  private async embeddingServiceJobsMarkCompleted(documentIds: string[]) {
    if (documentIds.length === 0) return 0;
    let completedCount = 0;
    for (const chunk of chunks(unique(documentIds), 1000)) {
      const rows = await this.db.execute(sql`
        update catalog_search_index_jobs
        set
          status = 'completed',
          finished_at = now(),
          updated_at = now()
        where catalog_id = ${this.config.CATALOG_ID}
          and job_type = 'refresh_embedding'
          and status = 'pending'
          and payload->>'search_document_id' in (${sql.join(chunk.map((documentId) => sql`${documentId}`), sql`, `)})
        returning id
      `);
      completedCount += rows.length;
    }

    return completedCount;
  }

  private async embeddingServiceJobsMarkCompletedById(jobIds: string[]) {
    if (jobIds.length === 0) return 0;
    let completedCount = 0;
    for (const chunk of chunks(unique(jobIds), 1000)) {
      const rows = await this.db.execute(sql`
        update catalog_search_index_jobs
        set
          status = 'completed',
          finished_at = now(),
          updated_at = now()
        where catalog_id = ${this.config.CATALOG_ID}
          and job_type = 'refresh_embedding'
          and status = 'pending'
          and id in (${sql.join(chunk.map((jobId) => sql`${jobId}`), sql`, `)})
        returning id
      `);
      completedCount += rows.length;
    }

    return completedCount;
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
    const staleIngestingBefore = new Date(Date.now() - ACTIVE_INGESTING_STALE_MS).toISOString();
    return this.db
      .select()
      .from(schema.catalogEmbeddingBatchJobs)
      .where(and(
        eq(schema.catalogEmbeddingBatchJobs.catalogId, this.config.CATALOG_ID),
        jobId
          ? eq(schema.catalogEmbeddingBatchJobs.id, jobId)
          : sql`(
              ${schema.catalogEmbeddingBatchJobs.status} = 'completed'
              or (
                ${schema.catalogEmbeddingBatchJobs.status} = 'ingesting'
                and ${schema.catalogEmbeddingBatchJobs.updatedAt} < ${staleIngestingBefore}::timestamptz
              )
            )`,
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
    const outputLines = content.split('\n').filter((line) => line.trim());
    for (let offset = 0; offset < outputLines.length;) {
      const remaining = limit ? limit - ingestedCount - failedCount - skippedCount : Number.POSITIVE_INFINITY;
      if (remaining <= 0) break;
      const lines = outputLines.slice(offset, offset + Math.min(INGEST_CHUNK_SIZE, remaining));
      offset += lines.length;
      const parsedLines = lines.map((line) => JSON.parse(line) as OpenAIBatchOutputLine);
      const documentIds = parsedLines.map((line) => line.custom_id).filter((value): value is string => Boolean(value));
      const documents = await this.loadSearchDocumentsById(documentIds, job.catalogId);
      const existingEmbeddings = await this.loadExistingEmbeddingsByDocumentId(documentIds, job.embeddingModel);
      const rows: Array<typeof schema.catalogSearchEmbeddings.$inferInsert> = [];
      const vectorDocuments: VectorIndexDocument[] = [];

      for (const parsed of parsedLines) {
        const documentId = parsed.custom_id;
        const document = documentId ? documents.get(documentId) : undefined;
        if (!documentId || !document) {
          skippedCount += 1;
          continue;
        }
        const embeddingText = buildSearchDocumentEmbeddingText(document);
        const embeddingTextHash = hashEmbeddingText(embeddingText);
        const existing = existingEmbeddings.get(document.id);
        if (existing?.status === 'ready' && existing.embeddingTextHash === embeddingTextHash) {
          ingestedCount += 1;
          processedDocumentIds.push(document.id);
          continue;
        }
        const vector = parsed.response?.body?.data?.[0]?.embedding;
        const failed = parsed.error || parsed.response?.status_code !== 200 || !isNumberVector(vector);
        rows.push({
          id: newId('semb'),
          catalogId: document.catalogId,
          catalogSearchDocumentId: document.id,
          embeddingProvider: 'openai',
          embeddingModel: job.embeddingModel,
          embeddingDimension: failed ? job.embeddingDimension : vector.length,
          embeddingText,
          embeddingTextHash,
          embeddingVector: failed ? [] : vector,
          embeddingVectorPg: failed ? [] : vector,
          status: failed ? 'failed' : 'ready',
          error: failed
            ? JSON.stringify(parsed.error ?? parsed.response ?? 'unknown batch embedding error').slice(0, 4000)
            : null,
        });
        if (failed) {
          failedCount += 1;
        } else {
          ingestedCount += 1;
          vectorDocuments.push({
            documentId: document.id,
            catalogId: document.catalogId,
            providerId: document.providerId,
            objectType: document.objectType,
            embeddingVector: vector,
            embeddingTextHash,
          });
        }
        processedDocumentIds.push(document.id);
      }

      await this.bulkRecordEmbeddingRows(rows);
      await this.bulkUpsertVectorDocuments(vectorDocuments);
      await this.updateIngestProgress(job, { ingestedCount, failedCount });
      console.log(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'info',
        event: 'embedding_batch_ingest_chunk',
        job_id: job.id,
        processed_count: ingestedCount + failedCount + skippedCount,
        ingested_count: ingestedCount,
        failed_count: failedCount,
        skipped_count: skippedCount,
      }));
    }
    await this.tryEmbeddingServiceJobsMarkCompleted(processedDocumentIds);
    return { ingestedCount, failedCount, skippedCount };
  }

  private async tryEmbeddingServiceJobsMarkCompleted(documentIds: string[]) {
    if (documentIds.length > 5000) {
      console.warn(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'warn',
        event: 'embedding_batch_index_job_cleanup_skipped',
        document_count: documentIds.length,
        reason: 'too_many_documents_for_json_payload_cleanup',
      }));
      return 0;
    }
    try {
      return await this.embeddingServiceJobsMarkCompleted(documentIds);
    } catch (error) {
      console.warn(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'warn',
        event: 'embedding_batch_index_job_cleanup_failed',
        document_count: documentIds.length,
        error: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000),
      }));
      return 0;
    }
  }

  private async loadSearchDocumentsById(documentIds: string[], catalogId: string) {
    if (documentIds.length === 0) return new Map<string, SearchDocument>();
    const rows = await this.db
      .select()
      .from(schema.catalogSearchDocuments)
      .where(and(
        eq(schema.catalogSearchDocuments.catalogId, catalogId),
        inArray(schema.catalogSearchDocuments.id, documentIds),
      ));
    return new Map(rows.map((row) => [row.id, row]));
  }

  private async loadExistingEmbeddingsByDocumentId(documentIds: string[], embeddingModel: string) {
    if (documentIds.length === 0) return new Map<string, typeof schema.catalogSearchEmbeddings.$inferSelect>();
    const rows = await this.db
      .select()
      .from(schema.catalogSearchEmbeddings)
      .where(and(
        eq(schema.catalogSearchEmbeddings.embeddingModel, embeddingModel),
        inArray(schema.catalogSearchEmbeddings.catalogSearchDocumentId, documentIds),
      ));
    return new Map(rows.map((row) => [row.catalogSearchDocumentId, row]));
  }

  private async updateIngestProgress(job: BatchBackfillJob, counts: { ingestedCount: number; failedCount: number }) {
    await this.db.update(schema.catalogEmbeddingBatchJobs)
      .set({
        ingestedCount: counts.ingestedCount,
        failedCount: counts.failedCount,
        updatedAt: new Date(),
      })
      .where(eq(schema.catalogEmbeddingBatchJobs.id, job.id));
  }

  private async bulkRecordEmbeddingRows(rows: Array<typeof schema.catalogSearchEmbeddings.$inferInsert>) {
    if (rows.length === 0) return;
    await this.db.insert(schema.catalogSearchEmbeddings)
      .values(rows)
      .onConflictDoUpdate({
        target: [
          schema.catalogSearchEmbeddings.catalogSearchDocumentId,
          schema.catalogSearchEmbeddings.embeddingModel,
        ],
        set: {
          embeddingProvider: sql`excluded.embedding_provider`,
          embeddingDimension: sql`excluded.embedding_dimension`,
          embeddingText: sql`excluded.embedding_text`,
          embeddingTextHash: sql`excluded.embedding_text_hash`,
          embeddingVector: sql`excluded.embedding_vector`,
          embeddingVectorPg: sql`excluded.embedding_vector_pg`,
          status: sql`excluded.status`,
          error: sql`excluded.error`,
          updatedAt: new Date(),
        },
      });
  }

  private async bulkUpsertVectorDocuments(documents: VectorIndexDocument[]) {
    const writableVectorIndex = this.embeddingService.writableVectorIndex;
    if (!writableVectorIndex || documents.length === 0) return;
    if (isBulkWritableVectorIndex(writableVectorIndex)) {
      await writableVectorIndex.bulkUpsert(documents);
      return;
    }
    for (const document of documents) {
      await writableVectorIndex.upsert(document);
    }
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
    return this.requestWithRetry(`/files/${encodeURIComponent(fileId)}/content`, {
      method: 'GET',
      text: true,
      timeoutMs: Math.max(this.timeoutMs, 10 * 60 * 1000),
    }, {
      attempts: 5,
      baseDelayMs: 5000,
    });
  }

  private async requestWithRetry<T = unknown>(path: string, options: {
    method: 'GET' | 'POST';
    json?: unknown;
    body?: BodyInit;
    text?: boolean;
    timeoutMs?: number;
  }, retry: { attempts: number; baseDelayMs: number }): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= retry.attempts; attempt += 1) {
      try {
        return await this.request<T>(path, options);
      } catch (error) {
        lastError = error;
        if (attempt >= retry.attempts || !isRetryableOpenAIError(error)) break;
        const delayMs = retry.baseDelayMs * attempt;
        console.warn(JSON.stringify({
          ts: new Date().toISOString(),
          level: 'warn',
          event: 'openai_batch_file_download_retry',
          path,
          attempt,
          next_delay_ms: delayMs,
          error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
        }));
        await sleep(delayMs);
      }
    }
    throw lastError;
  }

  private async request<T = unknown>(path: string, options: {
    method: 'GET' | 'POST';
    json?: unknown;
    body?: BodyInit;
    text?: boolean;
    timeoutMs?: number;
  }): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? this.timeoutMs);
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

function isBulkWritableVectorIndex(value: unknown): value is BulkWritableVectorIndexAdapter {
  return Boolean(value && typeof value === 'object' && 'bulkUpsert' in value);
}

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size) {
    result.push(items.slice(offset, offset + size));
  }
  return result;
}

function isRetryableOpenAIError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(' 429 ')
    || message.includes(' 500 ')
    || message.includes(' 502 ')
    || message.includes(' 503 ')
    || message.includes(' 504 ')
    || message.includes('aborted');
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
