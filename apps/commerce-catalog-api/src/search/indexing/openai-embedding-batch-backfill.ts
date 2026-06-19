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
import { EmbeddingWorkItemService } from './embedding-work-item-service';
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
type ExistingEmbedding = Pick<
  typeof schema.catalogSearchEmbeddings.$inferSelect,
  'catalogSearchDocumentId' | 'embeddingDimension' | 'status'
>;

const searchDocumentSelect = {
  id: schema.catalogSearchDocuments.id,
  catalogId: schema.catalogSearchDocuments.catalogId,
  catalogEntryId: schema.catalogSearchDocuments.catalogEntryId,
  commercialObjectId: schema.catalogSearchDocuments.commercialObjectId,
  providerId: schema.catalogSearchDocuments.providerId,
  objectId: schema.catalogSearchDocuments.objectId,
  objectType: schema.catalogSearchDocuments.objectType,
  documentStatus: schema.catalogSearchDocuments.documentStatus,
  title: schema.catalogSearchDocuments.title,
  normalizedTitle: schema.catalogSearchDocuments.normalizedTitle,
  summary: schema.catalogSearchDocuments.summary,
  brand: schema.catalogSearchDocuments.brand,
  normalizedBrand: schema.catalogSearchDocuments.normalizedBrand,
  category: schema.catalogSearchDocuments.category,
  normalizedCategory: schema.catalogSearchDocuments.normalizedCategory,
  sku: schema.catalogSearchDocuments.sku,
  normalizedSku: schema.catalogSearchDocuments.normalizedSku,
  currency: schema.catalogSearchDocuments.currency,
  availabilityStatus: schema.catalogSearchDocuments.availabilityStatus,
  amount: schema.catalogSearchDocuments.amount,
  listAmount: schema.catalogSearchDocuments.listAmount,
  hasImage: schema.catalogSearchDocuments.hasImage,
  hasProductUrl: schema.catalogSearchDocuments.hasProductUrl,
  discountPresent: schema.catalogSearchDocuments.discountPresent,
  qualityTier: schema.catalogSearchDocuments.qualityTier,
  availabilityRank: schema.catalogSearchDocuments.availabilityRank,
  qualityRank: schema.catalogSearchDocuments.qualityRank,
  searchText: schema.catalogSearchDocuments.searchText,
  searchVector: schema.catalogSearchDocuments.searchVector,
  facetPayload: schema.catalogSearchDocuments.facetPayload,
  rankingFeatures: schema.catalogSearchDocuments.rankingFeatures,
  visibleAttributesPayload: schema.catalogSearchDocuments.visibleAttributesPayload,
  explainPayload: schema.catalogSearchDocuments.explainPayload,
  sourceUpdatedAt: schema.catalogSearchDocuments.sourceUpdatedAt,
  indexedAt: schema.catalogSearchDocuments.indexedAt,
  createdAt: schema.catalogSearchDocuments.createdAt,
  updatedAt: schema.catalogSearchDocuments.updatedAt,
};

const embeddingBatchJobSelect = {
  id: schema.catalogEmbeddingBatchJobs.id,
  catalogId: schema.catalogEmbeddingBatchJobs.catalogId,
  status: schema.catalogEmbeddingBatchJobs.status,
  openaiBatchId: schema.catalogEmbeddingBatchJobs.openaiBatchId,
  inputFileId: schema.catalogEmbeddingBatchJobs.inputFileId,
  outputFileId: schema.catalogEmbeddingBatchJobs.outputFileId,
  errorFileId: schema.catalogEmbeddingBatchJobs.errorFileId,
  embeddingProvider: schema.catalogEmbeddingBatchJobs.embeddingProvider,
  embeddingModel: schema.catalogEmbeddingBatchJobs.embeddingModel,
  embeddingDimension: schema.catalogEmbeddingBatchJobs.embeddingDimension,
  requestedCount: schema.catalogEmbeddingBatchJobs.requestedCount,
  completedCount: schema.catalogEmbeddingBatchJobs.completedCount,
  failedCount: schema.catalogEmbeddingBatchJobs.failedCount,
  ingestedCount: schema.catalogEmbeddingBatchJobs.ingestedCount,
  ingestedOutputLineCount: schema.catalogEmbeddingBatchJobs.ingestedOutputLineCount,
  inputTextChars: schema.catalogEmbeddingBatchJobs.inputTextChars,
  metadata: schema.catalogEmbeddingBatchJobs.metadata,
  error: schema.catalogEmbeddingBatchJobs.error,
  submittedAt: schema.catalogEmbeddingBatchJobs.submittedAt,
  completedAt: schema.catalogEmbeddingBatchJobs.completedAt,
  ingestedAt: schema.catalogEmbeddingBatchJobs.ingestedAt,
  createdAt: schema.catalogEmbeddingBatchJobs.createdAt,
  updatedAt: schema.catalogEmbeddingBatchJobs.updatedAt,
};
type BatchCandidate = {
  workItemId: string;
  document: SearchDocument;
  inputText: string;
  inputTextHash: string;
};

export class OpenAIEmbeddingBatchBackfillService {
  private readonly client: OpenAIBatchClient;

  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly embeddingService: SearchEmbeddingService,
    private readonly embeddingWorkItems: EmbeddingWorkItemService,
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
    const jobId = options.dryRun ? null : newId('embbatch');
    const candidates = await this.loadCandidates({
      limit,
      providerId: options.providerId,
      embeddingBatchJobId: jobId ?? undefined,
      claimWorkItems: !options.dryRun,
    });

    const emptyTextDocumentIds = candidates
      .filter((candidate) => candidate.inputText.length === 0)
      .map((candidate) => candidate.document.id);
    if (!options.dryRun && jobId && emptyTextDocumentIds.length > 0) {
      await this.embeddingWorkItems.markFailedByDocumentIds({
        catalogId: this.config.CATALOG_ID,
        embeddingBatchJobId: jobId,
        documentIds: emptyTextDocumentIds,
        error: 'Search document has no embedding text for OpenAI batch request',
      });
    }

    const requestCandidates = candidates.filter((candidate) => candidate.inputText.length > 0);
    const inputTextChars = requestCandidates.reduce((sum, candidate) => sum + candidate.inputText.length, 0);
    if (options.dryRun) {
      return {
        status: 'dry_run' as const,
        requestedCount: requestCandidates.length,
        inputTextChars,
        sampleCustomIds: requestCandidates.slice(0, 5).map((candidate) => candidate.document.id),
      };
    }
    if (requestCandidates.length === 0) {
      return {
        status: 'empty' as const,
        requestedCount: 0,
        inputTextChars: 0,
      };
    }

    if (!jobId) {
      throw new Error('Embedding batch job id is required for non-dry-run submission');
    }
    const [createdJob] = await this.db.insert(schema.catalogEmbeddingBatchJobs).values({
      id: jobId,
      catalogId: this.config.CATALOG_ID,
      status: 'created',
      embeddingProvider: 'openai',
      embeddingModel: this.embeddingModel,
      embeddingDimension: this.config.EMBEDDING_DIMENSION,
      requestedCount: requestCandidates.length,
      inputTextChars,
      metadata: {
        provider_id: options.providerId ?? null,
      },
      submittedAt: new Date(),
    }).returning();
    const batchItems = await this.embeddingWorkItems.createBatchItems({
      catalogId: this.config.CATALOG_ID,
      embeddingBatchJobId: jobId,
      items: requestCandidates.map((candidate) => ({
        workItemId: candidate.workItemId,
        documentId: candidate.document.id,
        inputText: candidate.inputText,
        inputTextHash: candidate.inputTextHash,
      })),
    });
    if (batchItems.length !== requestCandidates.length) {
      throw new Error(`Embedding batch ${jobId} created ${batchItems.length} batch items for ${requestCandidates.length} requests`);
    }
    const requests = batchItems.map((item) => this.toBatchRequest({
      batchItemId: item.id,
      inputText: item.inputText,
    }));
    assertUniqueBatchCustomIds(requests);

    const jsonl = requests.map((request) => JSON.stringify(request)).join('\n') + '\n';
    let inputFile: { id: string } | null = null;
    let batch: OpenAIBatch | null = null;
    try {
      inputFile = await this.client.uploadBatchInput(`${jobId}.jsonl`, jsonl);
      batch = await this.client.createBatch({
        inputFileId: inputFile.id,
        metadata: {
          job_id: jobId,
          catalog_id: this.config.CATALOG_ID,
          embedding_model: this.config.EMBEDDING_MODEL,
          embedding_dimension: String(this.config.EMBEDDING_DIMENSION),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 4000) : String(error).slice(0, 4000);
      await this.embeddingWorkItems.markSubmittedBatchFailed({
        catalogId: this.config.CATALOG_ID,
        embeddingBatchJobId: jobId,
        error: message,
      });
      await this.db.update(schema.catalogEmbeddingBatchJobs)
        .set({
          status: 'failed',
          inputFileId: inputFile?.id ?? createdJob.inputFileId,
          error: message,
          updatedAt: new Date(),
        })
        .where(eq(schema.catalogEmbeddingBatchJobs.id, jobId));
      throw error;
    }

    const [row] = await this.db.update(schema.catalogEmbeddingBatchJobs)
      .set({
        status: normalizeBatchStatus(batch.status),
        openaiBatchId: batch.id,
        inputFileId: inputFile.id,
        outputFileId: batch.output_file_id ?? null,
        errorFileId: batch.error_file_id ?? null,
        completedCount: batch.request_counts?.completed ?? 0,
        failedCount: batch.request_counts?.failed ?? 0,
        updatedAt: new Date(),
      })
      .where(eq(schema.catalogEmbeddingBatchJobs.id, jobId))
      .returning();

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
      processedOutputLineCount: number;
    }> = [];

    for (const job of jobs) {
      if (!job.outputFileId) {
        await this.db.update(schema.catalogEmbeddingBatchJobs)
          .set({
            status: 'failed',
            error: 'Embedding batch is ingestible but has no output_file_id',
            updatedAt: new Date(),
          })
          .where(eq(schema.catalogEmbeddingBatchJobs.id, job.id));
        results.push({
          jobId: job.id,
          ingestedCount: 0,
          failedCount: 0,
          skippedCount: 0,
          processedOutputLineCount: 0,
        });
        continue;
      }
      await this.markJobIngesting(job.id);
      try {
        const content = options.outputFilePath
          ? await readFile(options.outputFilePath, 'utf8')
          : await this.client.downloadFileContent(job.outputFileId);
        const result = await this.ingestOutput(job, content, options.limit);
        const nextIngestedCount = job.ingestedCount + result.ingestedCount;
        const nextFailedCount = job.failedCount + result.failedCount;
        const nextIngestedOutputLineCount = job.ingestedOutputLineCount + result.processedOutputLineCount;
        const fullyProcessed = nextIngestedOutputLineCount >= job.requestedCount
          || nextIngestedCount + nextFailedCount >= job.requestedCount;
        if (!fullyProcessed && result.processedOutputLineCount === 0) {
          throw new Error(`Embedding batch ${job.id} output file has no remaining lines but only ${nextIngestedOutputLineCount}/${job.requestedCount} output lines were processed`);
        }
        await this.db.update(schema.catalogEmbeddingBatchJobs)
          .set({
            status: fullyProcessed ? 'ingested' : 'completed',
            ingestedCount: nextIngestedCount,
            failedCount: nextFailedCount,
            ingestedOutputLineCount: nextIngestedOutputLineCount,
            ingestedAt: fullyProcessed ? new Date() : job.ingestedAt,
            error: null,
            updatedAt: new Date(),
          })
          .where(eq(schema.catalogEmbeddingBatchJobs.id, job.id));
        results.push({ jobId: job.id, ...result });
      } catch (error) {
        await this.db.update(schema.catalogEmbeddingBatchJobs)
          .set({
            status: 'failed',
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
    const [row] = await this.db.execute(sql`
      select count(*)::int as count
      from (
        select 1
        from catalog_embedding_batch_jobs
        where catalog_id = ${this.config.CATALOG_ID}
          and (
            status in (${sql.join(statuses.map((status) => sql`${status}`), sql`, `)})
            or (
              status = 'ingesting'
              and updated_at >= ${activeIngestingAfter}::timestamptz
            )
          )
        limit ${this.config.CATALOG_EMBEDDING_BATCH_MAX_ACTIVE_JOBS + 1}
      ) active_embedding_batches
    `) as Array<{ count: number }>;

    return row?.count ?? 0;
  }

  private async loadCandidates(options: {
    limit: number;
    providerId?: string;
    embeddingBatchJobId?: string;
    claimWorkItems?: boolean;
  }) {
    if (options.claimWorkItems && !options.embeddingBatchJobId) {
      throw new Error('embeddingBatchJobId is required when claiming embedding work items');
    }
    const candidates: BatchCandidate[] = [];
    const selectedDocumentIds = new Set<string>();
    for (let sweep = 0; sweep < MAX_STALE_CANDIDATE_SWEEPS && candidates.length < options.limit; sweep += 1) {
      const remaining = options.limit - candidates.length;
      let pendingWorkItems = await this.loadWorkItemsForBatch({
        catalogId: this.config.CATALOG_ID,
        providerId: options.providerId,
        embeddingBatchJobId: options.embeddingBatchJobId,
        claimWorkItems: options.claimWorkItems,
        limit: remaining,
      });
      if (pendingWorkItems.length === 0) break;
      const workItemByDocumentId = new Map(pendingWorkItems.map((row) => [row.documentId, row.workItemId]));
      const documentIds = unique(pendingWorkItems
        .map((row) => row.documentId)
        .filter((value): value is string => Boolean(value))
        .filter((documentId) => !selectedDocumentIds.has(documentId)));
      if (documentIds.length === 0) break;

      const existingEmbeddings = await this.loadExistingEmbeddingsByDocumentId(documentIds, this.embeddingModel);
      const readyDocumentIds = new Set(documentIds.filter((documentId) => {
        const existing = existingEmbeddings.get(documentId);
        return existing?.status === 'ready' && existing.embeddingDimension === this.config.EMBEDDING_DIMENSION;
      }));
      await this.embeddingWorkItems.markCompletedByDocumentIds({
        catalogId: this.config.CATALOG_ID,
        documentIds: [...readyDocumentIds],
      });

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
        .select(searchDocumentSelect)
        .from(schema.catalogSearchDocuments)
        .where(and(...filters))
        .limit(remaining);
      const activeDocumentIds = new Set(documents.map((document) => document.id));
      const unavailableDocumentIds = candidateDocumentIds.filter((documentId) => !activeDocumentIds.has(documentId));
      for (const documentId of unavailableDocumentIds) {
        selectedDocumentIds.add(documentId);
      }
      if (options.claimWorkItems && options.embeddingBatchJobId && unavailableDocumentIds.length > 0) {
        const failedUnavailableCount = await this.embeddingWorkItems.markFailedByDocumentIds({
          catalogId: this.config.CATALOG_ID,
          embeddingBatchJobId: options.embeddingBatchJobId,
          documentIds: unavailableDocumentIds,
          error: 'Search document is missing, inactive, or outside the requested provider scope',
        });
        const expectedUnavailableCount = unique(unavailableDocumentIds).length;
        if (failedUnavailableCount !== expectedUnavailableCount) {
          throw new Error(`Embedding batch ${options.embeddingBatchJobId} failed ${expectedUnavailableCount} unavailable documents but updated ${failedUnavailableCount} work items`);
        }
      }
      for (const document of documents) {
        selectedDocumentIds.add(document.id);
        const inputText = truncateInput(
          buildSearchDocumentEmbeddingText(document),
          this.config.OPENAI_EMBEDDING_MAX_INPUT_CHARS,
        );
        candidates.push({
          workItemId: workItemByDocumentId.get(document.id)!,
          document,
          inputText,
          inputTextHash: hashEmbeddingText(inputText),
        });
      }
    }

    return candidates;
  }

  private async loadWorkItemsForBatch(options: {
    catalogId: string;
    limit: number;
    providerId?: string;
    embeddingBatchJobId?: string;
    claimWorkItems?: boolean;
  }) {
    if (!options.claimWorkItems) {
      return this.embeddingWorkItems.loadPendingDocumentIds(options);
    }
    if (!options.embeddingBatchJobId) {
      throw new Error('embeddingBatchJobId is required when claiming embedding work items');
    }
    return this.embeddingWorkItems.claimPendingDocumentIds({
      catalogId: options.catalogId,
      providerId: options.providerId,
      embeddingBatchJobId: options.embeddingBatchJobId,
      limit: options.limit,
    });
  }

  private toBatchRequest(input: { batchItemId: string; inputText: string }): BatchEmbeddingRequest {
    return {
      custom_id: input.batchItemId,
      method: 'POST',
      url: BATCH_EMBEDDINGS_ENDPOINT,
      body: {
        model: this.embeddingModel,
        input: input.inputText,
        dimensions: this.config.EMBEDDING_DIMENSION,
      },
    };
  }

  private async loadPollableJobs(jobId?: string) {
    const statuses = ['submitted', 'validating', 'in_progress', 'finalizing'] as const;
    return this.db
      .select(embeddingBatchJobSelect)
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
      .select(embeddingBatchJobSelect)
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
    const normalizedStatus = normalizeBatchStatus(batch.status);
    const completedWithoutOutput = normalizedStatus === 'completed' && !batch.output_file_id;
    const terminalFailure = normalizedStatus === 'failed'
      || normalizedStatus === 'expired'
      || normalizedStatus === 'cancelled'
      || completedWithoutOutput;
    const error = completedWithoutOutput
      ? 'OpenAI batch completed without output_file_id'
      : batch.errors ? JSON.stringify(batch.errors).slice(0, 4000) : job.error;
    const [row] = await this.db.update(schema.catalogEmbeddingBatchJobs)
      .set({
        status: completedWithoutOutput ? 'failed' : normalizedStatus,
        outputFileId: batch.output_file_id ?? job.outputFileId,
        errorFileId: batch.error_file_id ?? job.errorFileId,
        completedCount: batch.request_counts?.completed ?? job.completedCount,
        failedCount: batch.request_counts?.failed ?? job.failedCount,
        error,
        completedAt: batch.status === 'completed' ? new Date() : job.completedAt,
        updatedAt: new Date(),
      })
      .where(eq(schema.catalogEmbeddingBatchJobs.id, job.id))
      .returning();
    if (terminalFailure) {
      await this.embeddingWorkItems.markSubmittedBatchFailed({
        catalogId: job.catalogId,
        embeddingBatchJobId: job.id,
        error: error ?? `OpenAI batch ended with terminal status ${normalizedStatus}`,
      });
    }
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
    let processedOutputLineCount = 0;
    const outputBatchItemIds = new Set<string>();
    const outputLines = content.split('\n').filter((line) => line.trim());
    if (job.ingestedOutputLineCount > outputLines.length) {
      throw new Error(`Embedding batch ${job.id} ingest cursor ${job.ingestedOutputLineCount} exceeds output line count ${outputLines.length}`);
    }
    for (let offset = job.ingestedOutputLineCount; offset < outputLines.length;) {
      const remaining = limit ? limit - ingestedCount - failedCount - skippedCount : Number.POSITIVE_INFINITY;
      if (remaining <= 0) break;
      const lines = outputLines.slice(offset, offset + Math.min(INGEST_CHUNK_SIZE, remaining));
      offset += lines.length;
      const parsedLines = lines.map((line) => JSON.parse(line) as OpenAIBatchOutputLine);
      const chunkStartLine = job.ingestedOutputLineCount + processedOutputLineCount;
      assertValidOutputCustomIds(job.id, parsedLines, chunkStartLine);
      processedOutputLineCount += parsedLines.length;
      const batchItemIds = parsedLines.map((line) => line.custom_id).filter((value): value is string => Boolean(value));
      const batchItems = await this.embeddingWorkItems.loadBatchItemsById({
        catalogId: job.catalogId,
        embeddingBatchJobId: job.id,
        batchItemIds,
      });
      const workItemStatuses = await this.embeddingWorkItems.loadWorkItemStatusesById({
        catalogId: job.catalogId,
        workItemIds: [...batchItems.values()].map((item) => item.workItemId),
      });
      const documentIds = [...batchItems.values()].map((item) => item.documentId);
      const documents = await this.loadSearchDocumentsById(documentIds, job.catalogId);
      const rows: Array<typeof schema.catalogSearchEmbeddings.$inferInsert> = [];
      const vectorDocuments: VectorIndexDocument[] = [];
      const completedDocumentIds: string[] = [];
      const failedDocumentIds: string[] = [];
      const completedBatchItemIds: string[] = [];
      const failedBatchItemIds: string[] = [];

      for (const parsed of parsedLines) {
        const batchItemId = parsed.custom_id;
        const batchItem = batchItemId ? batchItems.get(batchItemId) : undefined;
        if (!batchItemId) {
          throw new Error(`Embedding batch ${job.id} output line is missing custom_id`);
        }
        if (!batchItem) {
          throw new Error(`Embedding batch ${job.id} output references unknown embedding batch item ${batchItemId}`);
        }
        if (batchItem.status !== 'submitted') {
          const workItemStatus = workItemStatuses.get(batchItem.workItemId)?.status;
          if (batchItem.status !== workItemStatus) {
            throw new Error(`Embedding batch ${job.id} batch item ${batchItem.id} is ${batchItem.status} but work item ${batchItem.workItemId} is ${workItemStatus ?? 'missing'}`);
          }
          skippedCount += 1;
          continue;
        }
        const documentId = batchItem.documentId;
        const document = documents.get(documentId);
        if (!document) {
          throw new Error(`Embedding batch ${job.id} output references unknown search document ${documentId}`);
        }
        if (outputBatchItemIds.has(batchItemId)) {
          throw new Error(`Embedding batch ${job.id} output contains duplicate custom_id ${batchItemId} across chunks`);
        }
        outputBatchItemIds.add(batchItemId);
        const vector = parsed.response?.body?.data?.[0]?.embedding;
        const failed = parsed.error || parsed.response?.status_code !== 200 || !isNumberVector(vector);
        rows.push({
          id: newId('semb'),
          catalogId: document.catalogId,
          catalogSearchDocumentId: document.id,
          embeddingProvider: 'openai',
          embeddingModel: job.embeddingModel,
          embeddingDimension: failed ? job.embeddingDimension : vector.length,
          embeddingText: batchItem.inputText,
          embeddingTextHash: batchItem.inputTextHash,
          embeddingVector: failed ? [] : vector,
          embeddingVectorPg: failed ? [] : vector,
          status: failed ? 'failed' : 'ready',
          error: failed
            ? JSON.stringify(parsed.error ?? parsed.response ?? 'unknown batch embedding error').slice(0, 4000)
            : null,
        });
        if (failed) {
          failedCount += 1;
          failedDocumentIds.push(document.id);
          failedBatchItemIds.push(batchItem.id);
        } else {
          ingestedCount += 1;
          vectorDocuments.push({
            documentId: document.id,
            catalogId: document.catalogId,
            providerId: document.providerId,
            objectType: document.objectType,
            embeddingVector: vector,
            embeddingTextHash: batchItem.inputTextHash,
          });
          completedDocumentIds.push(document.id);
          completedBatchItemIds.push(batchItem.id);
        }
      }

      await this.bulkRecordEmbeddingRows(rows);
      await this.bulkUpsertVectorDocuments(vectorDocuments);
      const completedBatchItemCount = await this.embeddingWorkItems.markBatchItemsCompleted({
        catalogId: job.catalogId,
        embeddingBatchJobId: job.id,
        batchItemIds: completedBatchItemIds,
        outputLineStart: chunkStartLine,
      });
      const failedBatchItemCount = await this.embeddingWorkItems.markBatchItemsFailed({
        catalogId: job.catalogId,
        embeddingBatchJobId: job.id,
        batchItemIds: failedBatchItemIds,
        error: `OpenAI batch ${job.id} returned failed embedding output`,
      });
      if (completedBatchItemCount !== unique(completedBatchItemIds).length) {
        throw new Error(`Embedding batch ${job.id} completed ${unique(completedBatchItemIds).length} batch items but updated ${completedBatchItemCount}`);
      }
      if (failedBatchItemCount !== unique(failedBatchItemIds).length) {
        throw new Error(`Embedding batch ${job.id} failed ${unique(failedBatchItemIds).length} batch items but updated ${failedBatchItemCount}`);
      }
      const completedWorkItemCount = await this.embeddingWorkItems.markCompletedByDocumentIds({
        catalogId: job.catalogId,
        embeddingBatchJobId: job.id,
        documentIds: completedDocumentIds,
      });
      const failedWorkItemCount = await this.embeddingWorkItems.markFailedByDocumentIds({
        catalogId: job.catalogId,
        embeddingBatchJobId: job.id,
        documentIds: failedDocumentIds,
        error: `OpenAI batch ${job.id} returned failed embedding output`,
      });
      if (completedWorkItemCount !== unique(completedDocumentIds).length) {
        throw new Error(`Embedding batch ${job.id} completed ${unique(completedDocumentIds).length} documents but updated ${completedWorkItemCount} work items`);
      }
      if (failedWorkItemCount !== unique(failedDocumentIds).length) {
        throw new Error(`Embedding batch ${job.id} failed ${unique(failedDocumentIds).length} documents but updated ${failedWorkItemCount} work items`);
      }
      await this.updateIngestProgress(job, {
        ingestedCount,
        failedCount,
        processedOutputLineCount,
      });
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
    return { ingestedCount, failedCount, skippedCount, processedOutputLineCount };
  }

  private async loadSearchDocumentsById(documentIds: string[], catalogId: string) {
    if (documentIds.length === 0) return new Map<string, SearchDocument>();
    const rows = await this.db
      .select(searchDocumentSelect)
      .from(schema.catalogSearchDocuments)
      .where(and(
        eq(schema.catalogSearchDocuments.catalogId, catalogId),
        inArray(schema.catalogSearchDocuments.id, documentIds),
      ));
    return new Map(rows.map((row) => [row.id, row]));
  }

  private async loadExistingEmbeddingsByDocumentId(documentIds: string[], embeddingModel: string) {
    if (documentIds.length === 0) return new Map<string, ExistingEmbedding>();
    const rows = await this.db
      .select({
        catalogSearchDocumentId: schema.catalogSearchEmbeddings.catalogSearchDocumentId,
        embeddingDimension: schema.catalogSearchEmbeddings.embeddingDimension,
        status: schema.catalogSearchEmbeddings.status,
      })
      .from(schema.catalogSearchEmbeddings)
      .where(and(
        eq(schema.catalogSearchEmbeddings.embeddingModel, embeddingModel),
        inArray(schema.catalogSearchEmbeddings.catalogSearchDocumentId, documentIds),
      ));
    return new Map(rows.map((row) => [row.catalogSearchDocumentId, row]));
  }

  private async updateIngestProgress(
    job: BatchBackfillJob,
    counts: { ingestedCount: number; failedCount: number; processedOutputLineCount: number },
  ) {
    await this.db.update(schema.catalogEmbeddingBatchJobs)
      .set({
        ingestedCount: job.ingestedCount + counts.ingestedCount,
        failedCount: job.failedCount + counts.failedCount,
        ingestedOutputLineCount: job.ingestedOutputLineCount + counts.processedOutputLineCount,
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
  throw new Error(`Unknown OpenAI batch status: ${status}`);
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

function assertUniqueBatchCustomIds(requests: BatchEmbeddingRequest[]) {
  const customIds = new Set<string>();
  const duplicates = new Set<string>();
  for (const request of requests) {
    if (customIds.has(request.custom_id)) {
      duplicates.add(request.custom_id);
      continue;
    }
    customIds.add(request.custom_id);
  }
  if (duplicates.size > 0) {
    throw new Error(`OpenAI embedding batch request contains duplicate custom_id values: ${[...duplicates].join(', ')}`);
  }
}

export const __OpenAIEmbeddingBatchBackfillTestOnly = {
  assertUniqueBatchCustomIds,
  assertValidOutputCustomIds,
  normalizeBatchStatus,
};

function assertValidOutputCustomIds(jobId: string, lines: OpenAIBatchOutputLine[], startLineIndex: number) {
  const seen = new Set<string>();
  for (let index = 0; index < lines.length; index += 1) {
    const customId = lines[index]?.custom_id;
    const lineNumber = startLineIndex + index + 1;
    if (!customId) {
      throw new Error(`Embedding batch ${jobId} output line ${lineNumber} is missing custom_id`);
    }
    if (seen.has(customId)) {
      throw new Error(`Embedding batch ${jobId} output contains duplicate custom_id ${customId} at line ${lineNumber}`);
    }
    seen.add(customId);
  }
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
