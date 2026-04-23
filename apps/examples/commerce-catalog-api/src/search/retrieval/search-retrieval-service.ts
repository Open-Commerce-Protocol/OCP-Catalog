import type { Db } from '@ocp-catalog/db';
import { schema } from '@ocp-catalog/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { EmbeddingProvider } from '../indexing/search-embedding-service';

export class SearchRetrievalService {
  constructor(
    private readonly db: Db,
    private readonly provider: EmbeddingProvider,
  ) {}

  async nearestNeighbors(input: {
    catalogId: string;
    query: string;
    limit: number;
    rerankLimit?: number;
    oversampleFactor?: number;
    documentIds?: string[];
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
      documentIds: input.documentIds,
    });
    if (annIds.length === 0) return new Map<string, number>();

    const exactScores = await this.exactScores(queryEmbedding.vector, annIds);
    return new Map(
      [...exactScores.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, rerankLimit),
    );
  }

  private async annCandidateIds(input: {
    catalogId: string;
    dimension: number;
    queryVector: number[];
    limit: number;
    documentIds?: string[];
  }) {
    const vectorLiteral = sql.raw(`'${formatVector(input.queryVector)}'::vector(${input.dimension})`);
    const castDimension = sql.raw(String(input.dimension));
    const documentIdFilter = input.documentIds?.length
      ? sql`and cse.catalog_search_document_id in ${sql.join(input.documentIds.map((documentId) => sql`${documentId}`), sql`, `)}`
      : sql``;

    const rows = await this.db.execute(sql`
      select
        cse.catalog_search_document_id as document_id
      from catalog_search_embeddings cse
      where cse.catalog_id = ${input.catalogId}
        and cse.embedding_model = ${this.provider.model}
        and cse.embedding_dimension = ${input.dimension}
        and cse.status = 'ready'
        and cse.embedding_vector_pg is not null
        ${documentIdFilter}
      order by (cse.embedding_vector_pg::vector(${castDimension})) <=> ${vectorLiteral}
      limit ${input.limit}
    `);

    return (rows as Array<Record<string, unknown>>)
      .map((row) => (typeof row.document_id === 'string' ? row.document_id : null))
      .filter((documentId): documentId is string => Boolean(documentId));
  }

  private async exactScores(queryVector: number[], documentIds: string[]) {
    if (documentIds.length === 0) return new Map<string, number>();

    const rows = await this.db
      .select({
        documentId: schema.catalogSearchEmbeddings.catalogSearchDocumentId,
        vector: schema.catalogSearchEmbeddings.embeddingVector,
      })
      .from(schema.catalogSearchEmbeddings)
      .where(and(
        eq(schema.catalogSearchEmbeddings.embeddingModel, this.provider.model),
        eq(schema.catalogSearchEmbeddings.status, 'ready'),
        inArray(schema.catalogSearchEmbeddings.catalogSearchDocumentId, documentIds),
      ));

    const scores = new Map<string, number>();
    for (const row of rows) {
      const score = cosineSimilarity(queryVector, row.vector);
      if (score > 0) scores.set(row.documentId, Number(score.toFixed(4)));
    }

    return scores;
  }
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

function formatVector(vector: number[]) {
  return `[${vector.map((value) => Number(value.toFixed(8))).join(',')}]`;
}
