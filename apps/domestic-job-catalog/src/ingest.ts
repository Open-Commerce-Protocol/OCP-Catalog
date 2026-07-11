import { buildJobEmbeddingText, type EmbeddingProvider } from "./embedding";
import { HttpError } from "./errors";
import { domesticJobInputSchema, objectSyncRequestSchema } from "./schemas";
import type { JobSearchIndex } from "./search/opensearch";
import type { JobRepository } from "./storage/postgres";

export class IngestService {
  constructor(
    private readonly jobs: JobRepository,
    private readonly search: JobSearchIndex,
    private readonly embeddings: EmbeddingProvider,
    private readonly catalogId: string,
  ) {}

  async sync(input: unknown) {
    const request = objectSyncRequestSchema.parse(input);
    if (request.catalog_id !== this.catalogId) {
      throw new HttpError("validation_error", `catalog_id must be ${this.catalogId}`, 400);
    }
    const results = [];
    for (const [index, object] of request.objects.entries()) {
      try {
        const job = domesticJobInputSchema.parse(normalizeSyncObject(object, request.provider_id));
        const embeddingText = buildJobEmbeddingText(job);
        const row = await this.jobs.upsertJob(job, embeddingText);
        if (row.matching_mode === "computer") {
          try {
            const embedding = await this.embeddings.embed(embeddingText);
            await this.jobs.markEmbeddingReady(row.id, embedding.model, embedding.dimension);
            await this.search.indexJob({ ...row, embedding_model: embedding.model, embedding_dimension: embedding.dimension, embedding_status: "ready" }, embedding.vector);
            await this.jobs.markIndexed(row.id);
          } catch (error) {
            await this.jobs.markEmbeddingFailed(row.id, error instanceof Error ? error.message : String(error));
            throw error;
          }
        } else {
          await this.search.indexJob(row);
          await this.jobs.markIndexed(row.id);
        }
        results.push({ index, id: row.id, status: "accepted" });
      } catch (error) {
        results.push({
          index,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const failed = results.filter((item) => item.status === "failed");
    if (failed.length > 0) {
      throw new HttpError("object_sync_failed", `${failed.length} object(s) failed validation or indexing.`, 400, {
        results,
      });
    }
    return {
      ocp_version: "1.0",
      kind: "ObjectSyncResult",
      catalog_id: this.catalogId,
      accepted_count: results.length,
      failed_count: 0,
      results,
    };
  }
}

function normalizeSyncObject(object: unknown, providerId?: string) {
  if (!object || typeof object !== "object" || Array.isArray(object)) return object;
  const record = object as Record<string, unknown>;
  if (record.domestic_job && typeof record.domestic_job === "object") {
    return { provider_id: providerId, ...(record.domestic_job as Record<string, unknown>) };
  }
  return { provider_id: providerId, ...record };
}
