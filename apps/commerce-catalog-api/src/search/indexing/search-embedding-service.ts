import type { Db } from '@ocp-catalog/db';
import { schema } from '@ocp-catalog/db';
import { newId } from '@ocp-catalog/shared';
import { and, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';

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
  ) {}

  async refreshForSearchDocument(documentId: string): Promise<SearchEmbeddingRefreshResult | null> {
    const document = await this.loadDocument(documentId);
    if (!document) return null;

    const embeddingText = buildEmbeddingText(document);
    if (!embeddingText) {
      return {
        status: 'skipped',
        documentId,
        reason: 'empty_text',
      };
    }

    const embeddingTextHash = hashText(embeddingText);
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
      const embeddingId = await this.upsertRow({
        id: existing?.id ?? newId('semb'),
        catalogId: document.catalogId,
        catalogSearchDocumentId: document.id,
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
      const embeddingId = await this.upsertRow({
        id: existing?.id ?? newId('semb'),
        catalogId: document.catalogId,
        catalogSearchDocumentId: document.id,
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

    return row?.id ?? input.id;
  }
}

function buildEmbeddingText(document: typeof schema.catalogSearchDocuments.$inferSelect) {
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

function hashText(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
