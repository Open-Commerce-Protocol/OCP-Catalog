import type { Db } from '@ocp-catalog/db';
import { schema } from '@ocp-catalog/db';
import { newId } from '@ocp-catalog/shared';
import { and, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { WritableVectorIndexAdapter } from '../retrieval/vector-index-adapter';

export type EmbeddingResult = {
  vector: number[];
  model: string;
  dimension: number;
};

export type EmbeddingProvider = {
  providerId: string;
  model: string;
  dimension: number;
  embed(input: string): Promise<EmbeddingResult>;
};

export type SearchEmbeddingRefreshResult =
  | {
    status: 'skipped';
    documentId: string;
    reason: 'empty_text' | 'unchanged';
  }
  | {
    status: 'ready' | 'failed';
    documentId: string;
    embeddingId: string;
    embeddingTextHash: string;
    error?: string;
  };

export class SearchEmbeddingService {
  constructor(
    private readonly db: Db,
    private readonly provider: EmbeddingProvider,
    readonly writableVectorIndex?: WritableVectorIndexAdapter,
  ) {}

  async refreshForSearchDocument(documentId: string): Promise<SearchEmbeddingRefreshResult | null> {
    const document = await this.loadDocument(documentId);
    if (!document) return null;

    const embeddingText = buildSearchDocumentEmbeddingText(document);
    if (!embeddingText) {
      return {
        status: 'skipped',
        documentId,
        reason: 'empty_text',
      };
    }

    const embeddingTextHash = hashEmbeddingText(embeddingText);
    const existing = await this.findExisting(documentId);
    if (existing?.embeddingTextHash === embeddingTextHash && existing.status === 'ready') {
      return {
        status: 'skipped',
        documentId,
        reason: 'unchanged',
      };
    }

    try {
      const embedding = await this.provider.embed(embeddingText);
      const embeddingId = await this.recordEmbeddingResult(document, {
        existingEmbeddingId: existing?.id,
        embeddingText,
        embeddingTextHash,
        embeddingDimension: embedding.dimension,
        embeddingVector: embedding.vector,
        status: 'ready',
        error: null,
      });

      return {
        status: 'ready',
        documentId,
        embeddingId,
        embeddingTextHash,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const embeddingId = await this.recordEmbeddingResult(document, {
        existingEmbeddingId: existing?.id,
        embeddingText,
        embeddingTextHash,
        embeddingDimension: this.provider.dimension,
        embeddingVector: [],
        status: 'failed',
        error: message,
      });

      return {
        status: 'failed',
        documentId,
        embeddingId,
        embeddingTextHash,
        error: message,
      };
    }
  }

  async refreshForCatalogEntry(catalogEntryId: string): Promise<SearchEmbeddingRefreshResult | null> {
    const [document] = await this.db
      .select({
        id: schema.catalogSearchDocuments.id,
      })
      .from(schema.catalogSearchDocuments)
      .where(eq(schema.catalogSearchDocuments.catalogEntryId, catalogEntryId))
      .limit(1);

    return document ? this.refreshForSearchDocument(document.id) : null;
  }

  async recordEmbeddingResult(
    document: typeof schema.catalogSearchDocuments.$inferSelect,
    input: {
      existingEmbeddingId?: string | null;
      embeddingText: string;
      embeddingTextHash: string;
      embeddingDimension: number;
      embeddingVector: number[];
      status: 'ready' | 'failed';
      error: string | null;
    },
  ) {
    return this.upsertRow({
      id: input.existingEmbeddingId ?? newId('semb'),
      catalogId: document.catalogId,
      catalogSearchDocumentId: document.id,
      providerId: document.providerId,
      objectType: document.objectType,
      embeddingText: input.embeddingText,
      embeddingTextHash: input.embeddingTextHash,
      embeddingDimension: input.embeddingDimension,
      embeddingVector: input.embeddingVector,
      status: input.status,
      error: input.error,
    });
  }

  async loadSearchDocument(documentId: string) {
    return this.loadDocument(documentId);
  }

  private async loadDocument(documentId: string) {
    const [document] = await this.db
      .select()
      .from(schema.catalogSearchDocuments)
      .where(eq(schema.catalogSearchDocuments.id, documentId))
      .limit(1);

    return document ?? null;
  }

  private async findExisting(documentId: string) {
    const [row] = await this.db
      .select()
      .from(schema.catalogSearchEmbeddings)
      .where(and(
        eq(schema.catalogSearchEmbeddings.catalogSearchDocumentId, documentId),
        eq(schema.catalogSearchEmbeddings.embeddingModel, this.provider.model),
      ))
      .limit(1);

    return row ?? null;
  }

  private async upsertRow(input: {
    id: string;
    catalogId: string;
    catalogSearchDocumentId: string;
    providerId: string;
    objectType: string;
    embeddingText: string;
    embeddingTextHash: string;
    embeddingDimension: number;
    embeddingVector: number[];
    status: 'ready' | 'failed';
    error: string | null;
  }) {
    const [row] = await this.db
      .insert(schema.catalogSearchEmbeddings)
      .values({
        id: input.id,
        catalogId: input.catalogId,
        catalogSearchDocumentId: input.catalogSearchDocumentId,
        embeddingProvider: this.provider.providerId,
        embeddingModel: this.provider.model,
        embeddingDimension: input.embeddingDimension,
        embeddingText: input.embeddingText,
        embeddingTextHash: input.embeddingTextHash,
        embeddingVector: input.embeddingVector,
        embeddingVectorPg: input.embeddingVector,
        status: input.status,
        error: input.error,
      })
      .onConflictDoUpdate({
        target: [
          schema.catalogSearchEmbeddings.catalogSearchDocumentId,
          schema.catalogSearchEmbeddings.embeddingModel,
        ],
        set: {
          embeddingProvider: this.provider.providerId,
          embeddingDimension: input.embeddingDimension,
          embeddingText: input.embeddingText,
          embeddingTextHash: input.embeddingTextHash,
          embeddingVector: input.embeddingVector,
          embeddingVectorPg: input.embeddingVector,
          status: input.status,
          error: input.error,
          updatedAt: new Date(),
        },
      })
      .returning({
        id: schema.catalogSearchEmbeddings.id,
      });

    if (input.status === 'ready' && this.writableVectorIndex) {
      await this.writableVectorIndex.upsert({
        documentId: input.catalogSearchDocumentId,
        catalogId: input.catalogId,
        providerId: input.providerId,
        objectType: input.objectType,
        embeddingVector: input.embeddingVector,
        embeddingTextHash: input.embeddingTextHash,
      });
    }

    return row?.id ?? input.id;
  }
}

export function buildSearchDocumentEmbeddingText(document: typeof schema.catalogSearchDocuments.$inferSelect) {
  return [
    document.title,
    document.summary,
    document.brand,
    document.category,
    document.sku,
    document.amount !== null ? `price ${document.amount}` : undefined,
    document.availabilityStatus ? `availability ${document.availabilityStatus}` : undefined,
    document.searchText,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n')
    .trim();
}

export function hashEmbeddingText(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
