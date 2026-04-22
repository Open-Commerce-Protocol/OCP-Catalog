import type { AppConfig } from '@ocp-catalog/config';
import type { Db } from '@ocp-catalog/db';
import { schema } from '@ocp-catalog/db';
import {
  catalogQueryRequestSchema,
  type CatalogQueryRequest,
  type CatalogQueryResult,
  type QueryResultItem,
} from '@ocp-catalog/ocp-schema';
import { AppError, newId } from '@ocp-catalog/shared';
import { and, desc, eq, ilike, inArray, or, type SQL } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { asProjection, visibleAttributes } from './projection';
import type { CatalogScenarioModule } from './scenario';
import type { CatalogEmbeddingService } from './embedding-service';
import { inferQueryMode } from './query-mode';

export type QueryMeta = {
  requesterKey?: string | null;
};

export class QueryService {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly scenario: CatalogScenarioModule,
    private readonly embeddings?: CatalogEmbeddingService,
  ) {}

  async query(input: unknown, meta: QueryMeta = {}): Promise<CatalogQueryResult> {
    const request = catalogQueryRequestSchema.parse(input);
    const queryMode = inferQueryModeForRequest(this.scenario, request.query_pack, request.query, request.filters);
    validateQueryCapability(this.scenario, request.query_pack, queryMode);
    if (queryMode === 'semantic' && !this.embeddings) {
      throw new AppError('validation_error', 'semantic query capability is not enabled for this Catalog yet', 400);
    }

    const catalogId = request.catalog_id ?? this.config.CATALOG_ID;
    if (catalogId !== this.config.CATALOG_ID) {
      throw new AppError('validation_error', `catalog_id must be ${this.config.CATALOG_ID}`, 400);
    }

    const terms = queryMode === 'filter' || queryMode === 'semantic' ? [] : tokenize(request.query);
    const baseConditions: SQL<unknown>[] = [
      eq(schema.catalogEntries.catalogId, catalogId),
      eq(schema.catalogEntries.entryStatus, 'active'),
    ];
    if (request.filters.provider_id) baseConditions.push(eq(schema.catalogEntries.providerId, request.filters.provider_id));
    if (request.filters.category) baseConditions.push(eq(schema.catalogEntries.category, request.filters.category));
    if (request.filters.brand) baseConditions.push(eq(schema.catalogEntries.brand, request.filters.brand));
    if (request.filters.currency) baseConditions.push(eq(schema.catalogEntries.currency, request.filters.currency));
    if (request.filters.availability_status) baseConditions.push(eq(schema.catalogEntries.availabilityStatus, request.filters.availability_status));

    const keywordConditions = [...baseConditions];
    if (terms.length > 0 && queryMode !== 'semantic') {
      keywordConditions.push(or(...terms.map((term) => ilike(schema.catalogEntries.searchText, `%${escapeLike(term)}%`)))!);
    }

    const usesSemanticScore = Boolean(this.embeddings && request.query.trim() && (queryMode === 'semantic' || queryMode === 'hybrid'));
    const keywordRows = queryMode === 'semantic'
      ? []
      : await this.selectCandidateRows(keywordConditions, computeCandidateLimit(request.limit, queryMode, terms.length));

    const semanticScores = usesSemanticScore
      ? await this.embeddings!.nearestNeighbors({
        catalogId,
        query: request.query,
        limit: computeSemanticResultLimit(request.limit, queryMode),
        rerankLimit: computeSemanticCandidateLimit(request.limit, queryMode),
        oversampleFactor: computeSemanticOversampleFactor(queryMode),
      })
      : new Map<string, number>();
    const semanticRows = semanticScores.size > 0
      ? await this.selectCandidateRows([...baseConditions, inArray(schema.catalogEntries.id, [...semanticScores.keys()])], semanticScores.size)
      : [];
    const rows = mergeRows(keywordRows, semanticRows);
    const items = rows
      .map((row): QueryResultItem | null => {
        const projection = asProjection(row.projection);
        if (!matchesFilters(projection, request.filters)) return null;

        const keywordScore = terms.length > 0 ? scoreProjection(projection, terms) : queryMode === 'semantic' ? 0 : 1;
        const semanticScore = semanticScores.get(row.entryId) ?? 0;
        const score = combinedScore(queryMode, keywordScore, semanticScore, projection, request.filters);
        if (queryMode === 'semantic' && semanticScore <= 0) return null;
        if (queryMode !== 'semantic' && terms.length > 0 && keywordScore <= 0 && semanticScore <= 0) return null;

        return {
          entry_id: row.entryId,
          provider_id: row.providerId,
          object_id: row.objectId,
          title: stringValue(projection.title) ?? row.objectId,
          ...(stringValue(projection.summary) ? { summary: stringValue(projection.summary) } : {}),
          score,
          attributes: visibleAttributes(projection),
          explain: request.explain ? buildItemExplain(projection, request.filters, terms, keywordScore, semanticScore, queryMode) : [],
        };
      })
      .filter((item): item is QueryResultItem => item !== null)
      .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
      .slice(0, request.limit);

    const result: CatalogQueryResult = {
      ocp_version: '1.0',
      kind: 'CatalogQueryResult',
      id: newId('qres'),
      catalog_id: catalogId,
      ...(request.query_pack ? { query_pack: request.query_pack } : {}),
      query: request.query,
      result_count: items.length,
      items,
      explain: request.explain
        ? [
          `Scanned ${rows.length} candidate catalog entries after indexed filtering.`,
          `Inferred query strategy: ${queryMode}.`,
          ...(usesSemanticScore ? ['Applied semantic ANN shortlist with exact cosine rerank.'] : []),
          `Applied filters: ${Object.keys(request.filters).length ? Object.keys(request.filters).join(', ') : 'none'}.`,
          `Returned top ${items.length} result(s).`,
        ]
        : [],
    };

    await this.db.insert(schema.queryAuditRecords).values({
      id: newId('qaudit'),
      catalogId,
      queryKind: 'catalog_query',
      requestPayload: request as unknown as Record<string, unknown>,
      resultCount: items.length,
      requesterKeyHash: meta.requesterKey ? hashKey(meta.requesterKey) : null,
    });

    return result;
  }

  private async selectCandidateRows(conditions: SQL<unknown>[], limit: number) {
    return this.db
      .select({
        entryId: schema.catalogEntries.id,
        title: schema.catalogEntries.title,
        summary: schema.catalogEntries.summary,
        providerId: schema.catalogEntries.providerId,
        objectId: schema.catalogEntries.objectId,
        searchText: schema.catalogEntries.searchText,
        projection: schema.catalogEntries.searchProjection,
        explainProjection: schema.catalogEntries.explainProjection,
      })
      .from(schema.catalogEntries)
      .where(and(...conditions))
      .orderBy(desc(schema.catalogEntries.updatedAt))
      .limit(limit);
  }
}

function validateQueryCapability(
  scenario: CatalogScenarioModule,
  requestedPack: string | undefined,
  requestedMode: 'keyword' | 'filter' | 'semantic' | 'hybrid',
) {
  const capabilities = scenario.queryCapabilities();
  const supportedModes = new Set(capabilities.flatMap((capability) => queryModesFromCapability(capability)));
  const supportedPacks = new Set(capabilities.flatMap((capability) => [
    stringValue(capability.capability_id),
    ...queryPackIdsFromCapability(capability),
  ].filter((value): value is string => Boolean(value))));

  if (!supportedModes.has(requestedMode)) {
    throw new AppError('validation_error', `Unsupported query strategy: ${requestedMode}`, 400, {
      supported_query_modes: [...supportedModes],
    });
  }

  if (requestedPack && !supportedPacks.has(requestedPack)) {
    throw new AppError('validation_error', `Unsupported query_pack: ${requestedPack}`, 400, {
      supported_query_packs: [...supportedPacks],
    });
  }
}

function inferQueryModeForRequest(
  scenario: CatalogScenarioModule,
  requestedPack: string | undefined,
  query: string,
  filters: CatalogQueryRequest['filters'],
) {
  if (!requestedPack) return inferQueryMode(query, filters);

  const packModes = queryModesForPack(scenario, requestedPack);
  if (packModes.includes('semantic')) return 'semantic' as const;
  if (packModes.includes('hybrid') && query.trim() && Object.values(filters).some(Boolean)) return 'hybrid' as const;
  if (packModes.includes('filter') && !query.trim()) return 'filter' as const;
  if (packModes.includes('keyword')) return 'keyword' as const;
  if (packModes.includes('hybrid')) return 'hybrid' as const;
  if (packModes.includes('filter')) return 'filter' as const;
  return inferQueryMode(query, filters);
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

function scoreProjection(projection: Record<string, unknown>, terms: string[]) {
  if (terms.length === 0) return 1;

  const text = stringValue(projection.text)?.toLowerCase() ?? '';
  let score = 0;
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

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function queryModesFromCapability(capability: Record<string, unknown>) {
  return queryPackDescriptors(capability).flatMap((descriptor) => descriptor.query_modes);
}

function queryPackIdsFromCapability(capability: Record<string, unknown>) {
  return queryPackDescriptors(capability).map((descriptor) => descriptor.pack_id);
}

function queryModesForPack(scenario: CatalogScenarioModule, requestedPack: string) {
  return scenario
    .queryCapabilities()
    .flatMap((capability) => queryPackDescriptors(capability))
    .filter((descriptor) => descriptor.pack_id === requestedPack)
    .flatMap((descriptor) => descriptor.query_modes);
}

function queryPackDescriptors(capability: Record<string, unknown>) {
  const queryPacks = capability.query_packs;
  if (!Array.isArray(queryPacks)) return [];

  return queryPacks
    .map((queryPack) => {
      if (typeof queryPack === 'string') {
        return { pack_id: queryPack, query_modes: [] as string[] };
      }

      if (typeof queryPack !== 'object' || queryPack === null) return null;
      const record = queryPack as Record<string, unknown>;
      const packId = stringValue(record.pack_id);
      if (!packId) return null;

      return {
        pack_id: packId,
        query_modes: stringArray(record.query_modes),
      };
    })
    .filter((queryPack): queryPack is { pack_id: string; query_modes: string[] } => Boolean(queryPack));
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

function computeSemanticOversampleFactor(queryMode: 'keyword' | 'filter' | 'semantic' | 'hybrid') {
  if (queryMode === 'semantic') return 5;
  if (queryMode === 'hybrid') return 4;
  return 1;
}

function escapeLike(value: string) {
  return value.replace(/[%_\\]/g, (match) => `\\${match}`);
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

export const __queryServiceTestOnly = {
  matchesFilters,
  scoreProjection,
  commerceQualityScore,
};
