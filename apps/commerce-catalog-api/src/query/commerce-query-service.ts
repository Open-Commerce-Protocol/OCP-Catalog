import type { AppConfig } from '@ocp-catalog/config';
import type { CatalogScenarioModule } from '@ocp-catalog/catalog-core';
import type { CatalogDb as Db } from '@ocp-catalog/catalog-db';
import { catalogSchema as schema } from '@ocp-catalog/catalog-db';
import {
  catalogQueryRequestSchema,
  type CatalogEntry,
  type CatalogEntryMatch,
  type CatalogQueryRequest,
  type CatalogQueryResult,
} from '@ocp-catalog/ocp-schema';
import { AppError, newId } from '@ocp-catalog/shared';
import { and, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { CatalogSemanticRetriever } from '../search/retrieval/catalog-semantic-retrieval-service';
import type { TextIndexStoredDocument } from '../search/retrieval/vector-index-adapter';
import { planCommerceQuery } from './commerce-query-planner';

type CandidateRow = {
  documentId: string;
  entryId: string;
  commercialObjectId: string;
  title: string;
  summary: string | null;
  providerId: string;
  objectId: string;
  objectType: string;
  searchText: string;
  fullTextRank: number;
  visibleAttributesPayload: Record<string, unknown>;
  explainPayload: Record<string, unknown>;
};

export type CommerceQueryMeta = {
  requesterKey?: string | null;
};

export class CommerceQueryService {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly scenario: CatalogScenarioModule,
    private readonly retrieval?: CatalogSemanticRetriever,
  ) {}

  async query(input: unknown, meta: CommerceQueryMeta = {}): Promise<CatalogQueryResult> {
    const startedAt = performance.now();
    const timings: Record<string, number> = {};
    const request = catalogQueryRequestSchema.parse(input);
    const queryPlan = planCommerceQuery(this.scenario, request, { retrievalAvailable: Boolean(this.retrieval) });
    const queryMode = queryPlan.queryMode;
    const explainEnabled = request.explain && queryPlan.supportsExplain;

    const catalogId = request.catalog_id ?? this.config.CATALOG_ID;
    if (catalogId !== this.config.CATALOG_ID) {
      throw new AppError('validation_error', `catalog_id must be ${this.config.CATALOG_ID}`, 400);
    }

    const terms = queryMode === 'filter' || queryMode === 'semantic' ? [] : tokenize(request.query);
    const baseConditions: SQL<unknown>[] = [
      eq(schema.catalogSearchDocuments.catalogId, catalogId),
      eq(schema.catalogSearchDocuments.documentStatus, 'active'),
    ];
    if (request.filters.provider_id) baseConditions.push(eq(schema.catalogSearchDocuments.providerId, request.filters.provider_id));
    if (request.filters.category) baseConditions.push(eq(schema.catalogSearchDocuments.normalizedCategory, normalize(request.filters.category)));
    if (request.filters.brand) baseConditions.push(eq(schema.catalogSearchDocuments.normalizedBrand, normalize(request.filters.brand)));
    if (request.filters.currency) baseConditions.push(eq(schema.catalogSearchDocuments.currency, request.filters.currency));
    if (request.filters.availability_status) baseConditions.push(eq(schema.catalogSearchDocuments.availabilityStatus, request.filters.availability_status));
    if (request.filters.sku) baseConditions.push(eq(schema.catalogSearchDocuments.normalizedSku, normalize(request.filters.sku)));
    if (request.filters.has_image !== undefined) baseConditions.push(eq(schema.catalogSearchDocuments.hasImage, request.filters.has_image));
    if (request.filters.in_stock_only) baseConditions.push(inArray(schema.catalogSearchDocuments.availabilityStatus, ['in_stock', 'low_stock']));
    if (request.filters.min_amount !== undefined) baseConditions.push(gte(schema.catalogSearchDocuments.amount, request.filters.min_amount));
    if (request.filters.max_amount !== undefined) baseConditions.push(lte(schema.catalogSearchDocuments.amount, request.filters.max_amount));

    const fullTextQuery = terms.length > 0 && queryMode !== 'semantic' ? request.query : undefined;

    const pageEnd = request.limit;
    const candidatePageEnd = pageEnd + 1;
    const usesSemanticScore = Boolean(this.retrieval && request.query.trim() && (queryMode === 'semantic' || queryMode === 'hybrid'));
    const usesOpenSearchText = Boolean(this.retrieval?.searchText && fullTextQuery);
    const usesDatabasePagination = queryMode === 'filter' && terms.length === 0 && !usesSemanticScore;
    let textSearchFailed = false;
    let textScores = new Map<string, number>();
    const textDocuments = new Map<string, TextIndexStoredDocument>();
    if (usesOpenSearchText) {
      try {
        const textStartedAt = performance.now();
        const textMatches = await this.retrieval!.searchText!({
          catalogId,
          query: request.query,
          limit: computeTextResultLimit(candidatePageEnd, queryMode),
          filters: {
            providerId: request.filters.provider_id,
            category: request.filters.category ? normalize(request.filters.category) : undefined,
            brand: request.filters.brand ? normalize(request.filters.brand) : undefined,
            currency: request.filters.currency,
            availabilityStatus: request.filters.availability_status,
            sku: request.filters.sku ? normalize(request.filters.sku) : undefined,
            hasImage: request.filters.has_image,
            inStockOnly: request.filters.in_stock_only,
            minAmount: request.filters.min_amount,
            maxAmount: request.filters.max_amount,
          },
        });
        timings.text_search_ms = elapsedMs(textStartedAt);
        textScores = new Map(textMatches.map((match) => [match.documentId, match.score]));
        for (const match of textMatches) {
          if (match.document) textDocuments.set(match.documentId, match.document);
        }
      } catch (error) {
        textSearchFailed = true;
        console.warn(JSON.stringify({
          ts: new Date().toISOString(),
          level: 'warn',
          event: 'opensearch_text_search_fallback',
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }
    const keywordStartedAt = performance.now();
    const keywordRows = queryMode === 'semantic'
      ? []
      : textScores.size > 0 && textDocuments.size === textScores.size
      ? [...textDocuments.values()].map((document) => textDocumentToCandidateRow(document, textScores.get(document.documentId) ?? 0))
      : textScores.size > 0
      ? await this.selectCandidateRows({
        conditions: [...baseConditions, inArray(schema.catalogSearchDocuments.id, [...textScores.keys()])],
        limit: textScores.size,
        rankByDocumentId: textScores,
      })
      : await this.selectCandidateRows({
        conditions: baseConditions,
        limit: usesDatabasePagination ? request.limit + 1 : computeCandidateLimit(candidatePageEnd, queryMode, terms.length),
        fullTextQuery: usesOpenSearchText ? undefined : fullTextQuery,
      });
    timings.keyword_rows_ms = elapsedMs(keywordStartedAt);

    let semanticSearchFailed = false;
    let semanticScores = new Map<string, number>();
    if (usesSemanticScore) {
      try {
        const semanticStartedAt = performance.now();
        semanticScores = await this.retrieval!.nearestNeighbors({
          catalogId,
          query: request.query,
          limit: computeSemanticResultLimit(candidatePageEnd, queryMode),
          rerankLimit: computeSemanticCandidateLimit(candidatePageEnd, queryMode),
          oversampleFactor: computeSemanticOversampleFactor(queryMode),
        });
        timings.semantic_search_ms = elapsedMs(semanticStartedAt);
      } catch (error) {
        if (queryMode === 'semantic') throw error;
        semanticSearchFailed = true;
        console.warn(JSON.stringify({
          ts: new Date().toISOString(),
          level: 'warn',
          event: 'semantic_search_fallback',
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }
    const semanticRowsStartedAt = performance.now();
    const semanticRows = semanticScores.size > 0
      ? await this.selectCandidateRows({
        conditions: [...baseConditions, inArray(schema.catalogSearchDocuments.id, [...semanticScores.keys()])],
        limit: semanticScores.size,
      })
      : [];
    timings.semantic_rows_ms = elapsedMs(semanticRowsStartedAt);
    const rankStartedAt = performance.now();
    const rows = mergeRows(keywordRows, semanticRows);
    const rankedMatches = rows
      .map((row): CatalogEntryMatch | null => {
        const projection = asRecord(row.visibleAttributesPayload);
        if (!matchesFilters(projection, request.filters)) return null;

        const keywordScore = terms.length > 0
          ? scoreProjection(projection, terms, textScores.get(row.documentId) ?? row.fullTextRank)
          : queryMode === 'semantic' ? 0 : 1;
        const semanticScore = semanticScores.get(row.documentId) ?? 0;
        const score = combinedScore(queryMode, keywordScore, semanticScore, projection, request.filters);
        if (queryMode === 'semantic' && semanticScore <= 0) return null;
        if (queryMode !== 'semantic' && terms.length > 0 && keywordScore <= 0 && semanticScore <= 0) return null;

        return {
          entry: {
            kind: 'CatalogEntry',
            catalog_id: catalogId,
            entry_id: row.entryId,
            provider_id: row.providerId,
            object_id: row.objectId,
            object_type: row.objectType,
            commercial_object_id: row.commercialObjectId,
            title: row.title || stringValue(projection.title) || row.objectId,
            ...(row.summary || stringValue(projection.summary) ? { summary: row.summary ?? stringValue(projection.summary) } : {}),
            ...(stringValue(projection.image_url) || stringValue(projection.primary_image_url)
              ? { image_url: stringValue(projection.image_url) ?? stringValue(projection.primary_image_url) }
              : {}),
            attributes: projection,
          } satisfies CatalogEntry,
          score,
          explain: explainEnabled ? buildItemExplain(projection, request.filters, terms, keywordScore, semanticScore, queryMode) : [],
        };
      })
      .filter((item): item is CatalogEntryMatch => item !== null)
      .sort((left, right) => right.score - left.score || left.entry.title.localeCompare(right.entry.title));
    const entries = usesDatabasePagination
      ? rankedMatches.slice(0, request.limit)
      : rankedMatches.slice(0, pageEnd);
    const hasMore = usesDatabasePagination
      ? rankedMatches.length > request.limit
      : rankedMatches.length > pageEnd;
    timings.rank_ms = elapsedMs(rankStartedAt);

    const auditId = newId('qaudit');
    const result: CatalogQueryResult = {
      ocp_version: '1.0',
      kind: 'CatalogQueryResult',
      id: newId('qres'),
      catalog_id: catalogId,
      query_pack: queryPlan.selectedQueryPack,
      query_mode: queryMode,
      query: request.query,
      result_count: entries.length,
      page: {
        limit: request.limit,
        offset: request.offset,
        has_more: hasMore,
      },
      entries,
      policy_summary: queryPlan.policySummary,
      audit_id: auditId,
      explain: explainEnabled
        ? [
          `Scanned ${rows.length} candidate catalog entries after indexed filtering.`,
          `Inferred query strategy: ${queryMode}.`,
          ...(textScores.size > 0 ? ['Applied OpenSearch text shortlist.'] : []),
          ...(textSearchFailed ? ['OpenSearch text shortlist failed; used PostgreSQL keyword fallback.'] : []),
          ...(usesSemanticScore && semanticScores.size > 0 ? ['Applied semantic ANN shortlist with exact cosine rerank.'] : []),
          ...(semanticSearchFailed ? ['Semantic retrieval failed; used keyword/text results only.'] : []),
          ...(usesSemanticScore && semanticScores.size === 0 ? ['Semantic retrieval ran but found no ready embedding candidates. Check embedding readiness and pending index jobs.'] : []),
          `Applied filters: ${Object.keys(request.filters).length ? Object.keys(request.filters).join(', ') : 'none'}.`,
          `Returned ${entries.length} result(s).`,
        ]
        : [],
    };

    const auditStartedAt = performance.now();
    await this.db.insert(schema.queryAuditRecords).values({
      id: auditId,
      catalogId,
      queryKind: 'catalog_query',
      requestPayload: request as unknown as Record<string, unknown>,
      resultCount: entries.length,
      requesterKeyHash: meta.requesterKey ? hashKey(meta.requesterKey) : null,
    });
    timings.audit_ms = elapsedMs(auditStartedAt);
    const totalMs = elapsedMs(startedAt);
    if (totalMs >= 1000) {
      console.log(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'info',
        event: 'commerce_query_timing',
        catalog_id: catalogId,
        query_mode: queryMode,
        query_pack: queryPlan.selectedQueryPack,
        result_count: entries.length,
        total_ms: totalMs,
        ...timings,
      }));
    }

    return result;
  }

  private async selectCandidateRows(input: {
    conditions: SQL<unknown>[];
    limit: number;
    fullTextQuery?: string;
    rankByDocumentId?: Map<string, number>;
  }): Promise<CandidateRow[]> {
    const conditions = [...input.conditions];
    const fullTextRank = input.fullTextQuery
      ? sql<number>`ts_rank(${schema.catalogSearchDocuments.searchVector}, plainto_tsquery('simple', ${input.fullTextQuery}))`
      : sql<number>`0`;
    const orderBy = input.fullTextQuery
      ? [desc(fullTextRank), desc(schema.catalogSearchDocuments.updatedAt)]
      : [desc(schema.catalogSearchDocuments.updatedAt)];

    if (input.fullTextQuery) {
      conditions.push(sql`${schema.catalogSearchDocuments.searchVector} @@ plainto_tsquery('simple', ${input.fullTextQuery})`);
    }

    return this.db
      .select({
        documentId: schema.catalogSearchDocuments.id,
        entryId: schema.catalogSearchDocuments.catalogEntryId,
        commercialObjectId: schema.catalogSearchDocuments.commercialObjectId,
        title: schema.catalogSearchDocuments.title,
        summary: schema.catalogSearchDocuments.summary,
        providerId: schema.catalogSearchDocuments.providerId,
        objectId: schema.catalogSearchDocuments.objectId,
        objectType: schema.catalogSearchDocuments.objectType,
        searchText: schema.catalogSearchDocuments.searchText,
        fullTextRank,
        visibleAttributesPayload: schema.catalogSearchDocuments.visibleAttributesPayload,
        explainPayload: schema.catalogSearchDocuments.explainPayload,
      })
      .from(schema.catalogSearchDocuments)
      .where(and(...conditions))
      .orderBy(...orderBy)
      .limit(input.limit)
      .then((rows) => input.rankByDocumentId
        ? rows.map((row) => ({ ...row, fullTextRank: input.rankByDocumentId!.get(row.documentId) ?? 0 }))
        : rows);
  }
}

function textDocumentToCandidateRow(document: TextIndexStoredDocument, score: number): CandidateRow {
  return {
    documentId: document.documentId,
    entryId: document.catalogEntryId,
    commercialObjectId: document.commercialObjectId,
    title: document.title,
    summary: document.summary,
    providerId: document.providerId,
    objectId: document.objectId,
    objectType: document.objectType,
    searchText: document.searchText,
    fullTextRank: score,
    visibleAttributesPayload: document.visibleAttributesPayload,
    explainPayload: {},
  };
}

function tokenize(query: string) {
  return query
    .toLowerCase()
    .split(/[\s,]+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

function matchesFilters(projection: Record<string, unknown>, filters: CatalogQueryRequest['filters']) {
  if (filters.provider_id && normalize(projection.provider_id) !== normalize(filters.provider_id)) return false;
  if (filters.category && normalize(projection.category) !== normalize(filters.category)) return false;
  if (filters.brand && normalize(projection.brand) !== normalize(filters.brand)) return false;
  if (filters.currency && normalize(projection.currency) !== normalize(filters.currency)) return false;
  if (filters.availability_status && normalize(projection.availability_status) !== normalize(filters.availability_status)) return false;
  if (filters.sku && normalize(projection.sku) !== normalize(filters.sku)) return false;
  if (filters.has_image !== undefined && booleanValue(projection.has_image) !== filters.has_image) return false;
  if (filters.in_stock_only && !['in_stock', 'low_stock'].includes(normalize(projection.availability_status))) return false;

  const amount = numberValue(projection.amount);
  if (filters.min_amount !== undefined && amount < filters.min_amount) return false;
  if (filters.max_amount !== undefined && amount > filters.max_amount) return false;

  return true;
}

function scoreProjection(projection: Record<string, unknown>, terms: string[], fullTextRank = 0) {
  if (terms.length === 0) return 1;

  const text = stringValue(projection.text)?.toLowerCase() ?? '';
  let score = fullTextRank * 10;
  for (const term of terms) {
    if (text.includes(term)) score += 1;
    if (normalize(projection.title).includes(term)) score += 2;
    if (normalize(projection.sku).includes(term)) score += 4;
    if (normalize(projection.brand).includes(term)) score += 1.5;
    if (normalize(projection.category).includes(term)) score += 1.25;
  }

  return Number(score.toFixed(4));
}

function combinedScore(
  queryMode: 'keyword' | 'filter' | 'semantic' | 'hybrid',
  keywordScore: number,
  semanticScore: number,
  projection: Record<string, unknown>,
  filters: CatalogQueryRequest['filters'],
) {
  const commerceScore = commerceQualityScore(projection, filters);
  if (queryMode === 'semantic') return Number((semanticScore + commerceScore).toFixed(4));
  if (queryMode === 'hybrid' && semanticScore > 0) {
    return Number((keywordScore * 0.55 + semanticScore * 2 + commerceScore).toFixed(4));
  }
  return Number((keywordScore + commerceScore).toFixed(4));
}

function buildItemExplain(
  projection: Record<string, unknown>,
  filters: CatalogQueryRequest['filters'],
  terms: string[],
  keywordScore: number,
  semanticScore: number,
  queryMode: 'keyword' | 'filter' | 'semantic' | 'hybrid',
) {
  const explain: string[] = [];
  if (terms.length > 0) explain.push(`Keyword score ${keywordScore} from term(s): ${terms.join(', ')}.`);
  if ((queryMode === 'semantic' || queryMode === 'hybrid') && semanticScore > 0) {
    explain.push(`Semantic score ${semanticScore}.`);
  }
  for (const [key, expected] of Object.entries(filters)) {
    if (expected !== undefined && expected !== false) explain.push(`Filter ${key} matched ${String(projection[key] ?? expected)}.`);
  }
  if (stringValue(projection.quality_tier)) explain.push(`Quality tier ${projection.quality_tier}.`);
  if (explain.length === 0) explain.push('Matched active catalog entry.');
  return explain;
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalize(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function booleanValue(value: unknown) {
  return value === true;
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function elapsedMs(startedAt: number) {
  return Number((performance.now() - startedAt).toFixed(2));
}

function hashKey(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function computeCandidateLimit(limit: number, queryMode: 'keyword' | 'filter' | 'semantic' | 'hybrid', termCount: number) {
  if (queryMode === 'semantic') return Math.min(Math.max(limit * 40, 200), 1000);
  if (queryMode === 'hybrid') return Math.min(Math.max(limit * 30, 150), 800);
  if (queryMode === 'filter' && termCount === 0) return Math.min(Math.max(limit * 20, 100), 500);
  return Math.min(Math.max(limit * 25, 120), 600);
}

function computeSemanticCandidateLimit(limit: number, queryMode: 'keyword' | 'filter' | 'semantic' | 'hybrid') {
  if (queryMode === 'semantic') return Math.min(Math.max(limit * 8, 40), 160);
  if (queryMode === 'hybrid') return Math.min(Math.max(limit * 6, 30), 120);
  return limit;
}

function computeSemanticResultLimit(limit: number, queryMode: 'keyword' | 'filter' | 'semantic' | 'hybrid') {
  if (queryMode === 'semantic') return Math.min(Math.max(limit * 20, 80), 400);
  if (queryMode === 'hybrid') return Math.min(Math.max(limit * 12, 60), 240);
  return limit;
}

function computeTextResultLimit(limit: number, queryMode: 'keyword' | 'filter' | 'semantic' | 'hybrid') {
  if (queryMode === 'hybrid') return Math.min(Math.max(limit * 20, 100), 500);
  if (queryMode === 'keyword') return Math.min(Math.max(limit * 30, 150), 800);
  return limit;
}

function computeSemanticOversampleFactor(queryMode: 'keyword' | 'filter' | 'semantic' | 'hybrid') {
  if (queryMode === 'semantic') return 5;
  if (queryMode === 'hybrid') return 4;
  return 1;
}

function mergeRows<
  T extends {
    entryId: string;
  },
>(...groups: T[][]) {
  const rows = new Map<string, T>();
  for (const group of groups) {
    for (const row of group) {
      if (!rows.has(row.entryId)) rows.set(row.entryId, row);
    }
  }
  return [...rows.values()];
}

function commerceQualityScore(
  projection: Record<string, unknown>,
  filters: CatalogQueryRequest['filters'],
) {
  let score = 0;
  const amount = numberValue(projection.amount);
  if (amount > 0) score += 0.35;
  const listAmount = numberValue(projection.list_amount);
  if (listAmount > amount && amount > 0) score += 0.08;
  if (booleanValue(projection.has_product_url)) score += 0.2;
  if (booleanValue(projection.has_image)) score += 0.25;

  const availability = normalize(projection.availability_status);
  if (availability === 'in_stock') score += 0.35;
  else if (availability === 'low_stock') score += 0.2;
  else if (availability === 'preorder') score += 0.05;
  else if (availability === 'out_of_stock') score -= filters.in_stock_only ? 1 : 0.35;

  const qualityTier = normalize(projection.quality_tier);
  if (qualityTier === 'rich') score += 0.3;
  else if (qualityTier === 'standard') score += 0.15;

  return score;
}

export const __commerceQueryServiceTestOnly = {
  matchesFilters,
  scoreProjection,
  commerceQualityScore,
};
