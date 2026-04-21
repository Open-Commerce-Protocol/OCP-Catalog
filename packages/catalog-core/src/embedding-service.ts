import type { Db } from '@ocp-catalog/db';
import { schema } from '@ocp-catalog/db';
import type { CommercialObject } from '@ocp-catalog/ocp-schema';
import { newId } from '@ocp-catalog/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { CatalogScenarioModule, SearchProjection } from './scenario';

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

export class CatalogEmbeddingService {
  constructor(
    private readonly db: Db,
    private readonly scenario: CatalogScenarioModule,
    private readonly provider: EmbeddingProvider,
  ) {}

  async upsertEntryEmbedding(input: {
    catalogId: string;
    catalogEntryId: string;
    object: CommercialObject;
    projection: SearchProjection;
  }) {
    const embeddingText = this.embeddingText(input.object, input.projection);
    if (!embeddingText) return;

    const textHash = hashText(embeddingText);
    try {
      const embedding = await this.provider.embed(embeddingText);
      await this.upsertRow({
        catalogId: input.catalogId,
        catalogEntryId: input.catalogEntryId,
        embeddingText,
        embeddingTextHash: textHash,
        embeddingDimension: embedding.dimension,
        embeddingVector: embedding.vector,
        status: 'ready',
        error: null,
      });
    } catch (error) {
      await this.upsertRow({
        catalogId: input.catalogId,
        catalogEntryId: input.catalogEntryId,
        embeddingText,
        embeddingTextHash: textHash,
        embeddingDimension: this.provider.dimension,
        embeddingVector: [],
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async scoreQuery(query: string, entryIds: string[]) {
    const normalizedQuery = query.trim();
    if (!normalizedQuery || entryIds.length === 0) return new Map<string, number>();

    const queryEmbedding = await this.provider.embed(normalizedQuery);
    return this.exactScores(queryEmbedding.vector, entryIds);
  }

  async nearestNeighbors(input: {
    catalogId: string;
    query: string;
    limit: number;
    rerankLimit?: number;
    oversampleFactor?: number;
    entryIds?: string[];
  }) {
    const normalizedQuery = input.query.trim();
    if (!normalizedQuery || input.limit <= 0) return new Map<string, number>();

    const queryEmbedding = await this.provider.embed(normalizedQuery);
    const rerankLimit = Math.max(input.rerankLimit ?? input.limit, input.limit);
    const annLimit = Math.max(
      input.limit,
      rerankLimit,
      Math.ceil(rerankLimit * Math.max(input.oversampleFactor ?? 4, 1)),
    );
    const annIds = await this.annCandidateIds({
      catalogId: input.catalogId,
      dimension: queryEmbedding.dimension,
      queryVector: queryEmbedding.vector,
      limit: annLimit,
      entryIds: input.entryIds,
    });
    if (annIds.length === 0) return new Map<string, number>();

    const exactScores = await this.exactScores(queryEmbedding.vector, annIds);
    return new Map(
      [...exactScores.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, rerankLimit),
    );
  }

  private embeddingText(object: CommercialObject, projection: SearchProjection) {
    const text = this.scenario.buildEmbeddingText?.(object, projection) ?? stringValue(projection.text);
    const normalized = text?.trim();
    return normalized && normalized.length > 0 ? normalized : null;
  }

  private async upsertRow(input: {
    catalogId: string;
    catalogEntryId: string;
    embeddingText: string;
    embeddingTextHash: string;
    embeddingDimension: number;
    embeddingVector: number[];
    status: 'ready' | 'failed';
    error: string | null;
  }) {
    await this.db
      .insert(schema.catalogEntryEmbeddings)
      .values({
        id: newId('emb'),
        catalogId: input.catalogId,
        catalogEntryId: input.catalogEntryId,
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
          schema.catalogEntryEmbeddings.catalogEntryId,
          schema.catalogEntryEmbeddings.embeddingModel,
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
      });
  }

  private async annCandidateIds(input: {
    catalogId: string;
    dimension: number;
    queryVector: number[];
    limit: number;
    entryIds?: string[];
  }) {
    const vectorLiteral = sql.raw(`'${formatVector(input.queryVector)}'::vector(${input.dimension})`);
    const castDimension = sql.raw(String(input.dimension));
    const entryIdFilter = input.entryIds?.length
      ? sql`and ce.catalog_entry_id in ${sql.join(input.entryIds.map((entryId) => sql`${entryId}`), sql`, `)}`
      : sql``;

    const rows = await this.db.execute(sql`
      select
        ce.catalog_entry_id as entry_id
      from catalog_entry_embeddings ce
      where ce.catalog_id = ${input.catalogId}
        and ce.embedding_model = ${this.provider.model}
        and ce.embedding_dimension = ${input.dimension}
        and ce.status = 'ready'
        and ce.embedding_vector_pg is not null
        ${entryIdFilter}
      order by (ce.embedding_vector_pg::vector(${castDimension})) <=> ${vectorLiteral}
      limit ${input.limit}
    `);

    return (rows as Array<Record<string, unknown>>)
      .map((row) => (typeof row.entry_id === 'string' ? row.entry_id : null))
      .filter((entryId): entryId is string => Boolean(entryId));
  }

  private async exactScores(queryVector: number[], entryIds: string[]) {
    if (entryIds.length === 0) return new Map<string, number>();

    const rows = await this.db
      .select({
        entryId: schema.catalogEntryEmbeddings.catalogEntryId,
        vector: schema.catalogEntryEmbeddings.embeddingVector,
      })
      .from(schema.catalogEntryEmbeddings)
      .where(and(
        eq(schema.catalogEntryEmbeddings.embeddingModel, this.provider.model),
        eq(schema.catalogEntryEmbeddings.status, 'ready'),
        inArray(schema.catalogEntryEmbeddings.catalogEntryId, entryIds),
      ));

    const scores = new Map<string, number>();
    for (const row of rows) {
      const score = cosineSimilarity(queryVector, row.vector);
      if (score > 0) scores.set(row.entryId, Number(score.toFixed(4)));
    }

    return scores;
  }
}

function hashText(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function cosineSimilarity(left: number[], right: number[]) {
  if (left.length === 0 || left.length !== right.length) return 0;

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) return 0;
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function formatVector(vector: number[]) {
  return `[${vector.map((value) => Number(value.toFixed(8))).join(',')}]`;
}
