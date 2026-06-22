import type { CatalogDb as Db } from '@ocp-catalog/catalog-db';
import { catalogSchema as schema } from '@ocp-catalog/catalog-db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type {
  VectorIndexAdapter,
  VectorIndexHealth,
  VectorIndexProfile,
  VectorIndexQueryInput,
  VectorIndexQueryResult,
} from './vector-index-adapter';

export class PostgresLocalVectorIndexAdapter implements VectorIndexAdapter {
  readonly profile: VectorIndexProfile;

  constructor(
    private readonly db: Db,
    profile: VectorIndexProfile,
  ) {
    this.profile = profile;
  }

  async query(input: VectorIndexQueryInput): Promise<VectorIndexQueryResult> {
    if (input.queryVector.length === 0 || input.limit <= 0) {
      return { profile: this.profile, matches: [] };
    }

    const rerankLimit = Math.max(input.rerankLimit ?? input.limit, input.limit);
    const annLimit = Math.max(
      input.limit,
      rerankLimit,
      Math.ceil(rerankLimit * Math.max(input.oversampleFactor ?? 4, 1)),
    );
    const annIds = await this.annCandidateIds({
      catalogId: input.catalogId,
      queryVector: input.queryVector,
      limit: annLimit,
      documentIds: input.documentIds,
    });
    if (annIds.length === 0) return { profile: this.profile, matches: [] };

    const exactScores = await this.exactScores(input.catalogId, input.queryVector, annIds);
    const matches = [...exactScores.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, rerankLimit)
      .map(([documentId, score]) => ({ documentId, score }));

    return { profile: this.profile, matches };
  }

  async health(): Promise<VectorIndexHealth> {
    await this.db.execute(sql`select 1`);
    return {
      profile: this.profile,
      available: true,
    };
  }

  private async annCandidateIds(input: {
    catalogId: string;
    queryVector: number[];
    limit: number;
    documentIds?: string[];
  }) {
    const vectorLiteral = sql.raw(`'${formatVector(input.queryVector)}'::vector(${this.profile.embeddingDimension})`);
    const castDimension = sql.raw(String(this.profile.embeddingDimension));
    const documentIdFilter = input.documentIds?.length
      ? sql`and cse.catalog_search_document_id in (${sql.join(input.documentIds.map((documentId) => sql`${documentId}`), sql`, `)})`
      : sql``;

    const rows = await this.db.execute(sql`
      select
        cse.catalog_search_document_id as document_id
      from catalog_search_embeddings cse
      where cse.catalog_id = ${input.catalogId}
        and cse.embedding_model = ${this.profile.embeddingModel}
        and cse.embedding_dimension = ${this.profile.embeddingDimension}
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

  private async exactScores(catalogId: string, queryVector: number[], documentIds: string[]) {
    if (documentIds.length === 0) return new Map<string, number>();

    const rows = await this.db
      .select({
        documentId: schema.catalogSearchEmbeddings.catalogSearchDocumentId,
        vector: schema.catalogSearchEmbeddings.embeddingVector,
      })
      .from(schema.catalogSearchEmbeddings)
      .where(and(
        eq(schema.catalogSearchEmbeddings.catalogId, catalogId),
        eq(schema.catalogSearchEmbeddings.embeddingModel, this.profile.embeddingModel),
        eq(schema.catalogSearchEmbeddings.embeddingDimension, this.profile.embeddingDimension),
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
