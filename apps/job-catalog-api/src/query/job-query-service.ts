import type { CatalogDb as Db } from '@ocp-catalog/catalog-db';
import { catalogSchema as schema } from '@ocp-catalog/catalog-db';
import type { CatalogEntry, CatalogEntryMatch, CatalogQueryResult } from '@ocp-catalog/ocp-schema';
import { AppError, newId } from '@ocp-catalog/shared';
import { and, desc, eq, gte, ilike, lte, sql, type SQL } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { JobCatalogConfig } from '../config';

const jobFiltersSchema = z.object({
  company: z.string().min(1).optional(),
  location: z.string().min(1).optional(),
  site: z.string().min(1).optional(),
  is_remote: z.boolean().optional(),
  work_from_home_type: z.string().min(1).optional(),
  job_type: z.string().min(1).optional(),
  job_level: z.string().min(1).optional(),
  job_function: z.string().min(1).optional(),
  currency: z.string().min(1).optional(),
  salary_min: z.number().nonnegative().optional(),
  salary_max: z.number().nonnegative().optional(),
  date_posted_after: z.string().min(1).optional(),
  date_posted_before: z.string().min(1).optional(),
  provider_id: z.string().min(1).optional(),
  has_salary: z.boolean().optional(),
  has_direct_url: z.boolean().optional(),
}).strict();

const jobQueryRequestSchema = z.object({
  ocp_version: z.literal('1.0').optional(),
  kind: z.literal('CatalogQueryRequest').optional(),
  catalog_id: z.string().min(1).optional(),
  query_pack: z.enum([
    'ocp.query.keyword.v1',
    'ocp.query.filter.v1',
    'ocp.job.search.v1',
    'ocp.query.semantic.v1',
  ]).optional(),
  query_mode: z.enum(['keyword', 'filter', 'semantic', 'hybrid']).optional(),
  query: z.string().max(500).optional().default(''),
  filters: jobFiltersSchema.optional().default({}),
  limit: z.number().int().min(1).max(50).optional().default(20),
  offset: z.literal(0).optional().default(0),
  cursor: z.string().min(1).max(512).optional(),
  explain: z.boolean().optional().default(true),
}).strict();

type JobQueryRequest = z.infer<typeof jobQueryRequestSchema>;
type JobFilters = z.infer<typeof jobFiltersSchema>;

type CandidateRow = {
  entryId: string;
  commercialObjectId: string;
  title: string;
  summary: string | null;
  providerId: string;
  objectId: string;
  objectType: string;
  searchText: string;
  projection: Record<string, unknown>;
  explainProjection: Record<string, unknown>;
  updatedAt: Date;
};

export type JobQueryMeta = {
  requesterKey?: string | null;
};

export class JobQueryService {
  constructor(
    private readonly db: Db,
    private readonly config: Pick<JobCatalogConfig, 'CATALOG_ID' | 'JOB_CATALOG_SEMANTIC_QUERY_ENABLED'>,
  ) {}

  async query(input: unknown, meta: JobQueryMeta = {}): Promise<CatalogQueryResult> {
    const request = jobQueryRequestSchema.parse(input);
    const catalogId = request.catalog_id ?? this.config.CATALOG_ID;
    if (catalogId !== this.config.CATALOG_ID) {
      throw new AppError('validation_error', `catalog_id must be ${this.config.CATALOG_ID}`, 400);
    }

    const queryMode = selectQueryMode(request);
    if (queryMode === 'semantic' || queryMode === 'hybrid') {
      throw new AppError('validation_error', 'Semantic job search is not enabled for this catalog', 503, {
        query_mode: queryMode,
      });
    }
    if (queryMode === 'keyword' && request.cursor) {
      throw new AppError('validation_error', 'Cursor pagination is only supported for structured job lists', 400, {
        query_mode: queryMode,
      });
    }

    const rows = await this.selectCandidateRows(catalogId, request, queryMode);
    const terms = tokenize(request.query);
    const explainEnabled = request.explain;
    const matches = rows
      .map((row): CatalogEntryMatch | null => {
        const projection = asRecord(row.projection);
        if (!matchesFilters(projection, request.filters)) return null;
        const keywordScore = terms.length > 0 ? scoreProjection(projection, terms, row.searchText) : 1;
        if (queryMode === 'keyword' && terms.length > 0 && keywordScore <= 0) return null;
        const filterScore = jobQualityScore(projection, request.filters);
        const score = Number((keywordScore + filterScore).toFixed(4));
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
            attributes: visibleJobAttributes(projection),
          } satisfies CatalogEntry,
          score,
          explain: explainEnabled ? buildItemExplain(projection, request.filters, terms, keywordScore) : [],
        };
      })
      .filter((match): match is CatalogEntryMatch => match !== null)
      .sort((left, right) => right.score - left.score || left.entry.title.localeCompare(right.entry.title));

    const entries = matches.slice(0, request.limit);
    const auditId = newId('qaudit');
    await this.db.insert(schema.queryAuditRecords).values({
      id: auditId,
      catalogId,
      queryKind: 'job_catalog_query',
      requestPayload: request as unknown as Record<string, unknown>,
      resultCount: entries.length,
      requesterKeyHash: meta.requesterKey ? hashKey(meta.requesterKey) : null,
    });

    return {
      ocp_version: '1.0',
      kind: 'CatalogQueryResult',
      id: newId('qres'),
      catalog_id: catalogId,
      query_pack: request.query_pack ?? (queryMode === 'filter' ? 'ocp.query.filter.v1' : 'ocp.query.keyword.v1'),
      query_mode: queryMode,
      query: request.query,
      result_count: entries.length,
      page: {
        limit: request.limit,
        offset: request.offset,
        has_more: queryMode === 'filter' && matches.length > request.limit,
        ...(queryMode === 'filter' && rows.length > request.limit && rows.length > 0
          ? { next_cursor: encodeCursor(rows[rows.length - 1]!) }
          : {}),
      },
      entries,
      policy_summary: {
        selected_capability_id: 'ocp.job.search.v1',
        selected_query_pack: request.query_pack,
        query_mode: queryMode,
        supports_explain: true,
        accepted_filters: Object.keys(request.filters),
        rejected_filters: [],
        warnings: [],
      },
      audit_id: auditId,
      explain: explainEnabled
        ? [
          `Scanned ${rows.length} active job catalog entries.`,
          `Inferred query strategy: ${queryMode}.`,
          `Applied filters: ${Object.keys(request.filters).length ? Object.keys(request.filters).join(', ') : 'none'}.`,
          `Returned ${entries.length} result(s).`,
        ]
        : [],
    };
  }

  private async selectCandidateRows(
    catalogId: string,
    request: JobQueryRequest,
    queryMode: 'keyword' | 'filter' | 'semantic' | 'hybrid',
  ): Promise<CandidateRow[]> {
    const conditions: SQL<unknown>[] = [
      eq(schema.catalogEntries.catalogId, catalogId),
      eq(schema.catalogEntries.objectType, 'job'),
      eq(schema.catalogEntries.entryStatus, 'active'),
    ];
    if (request.filters.provider_id) conditions.push(eq(schema.catalogEntries.providerId, request.filters.provider_id));
    if (request.filters.company) conditions.push(jsonTextEq(schema.catalogEntries.searchProjection, 'company', request.filters.company));
    if (request.filters.site) conditions.push(jsonTextEq(schema.catalogEntries.searchProjection, 'site', request.filters.site));
    if (request.filters.location) conditions.push(jsonTextIlike(schema.catalogEntries.searchProjection, 'location', `%${escapeLike(request.filters.location)}%`));
    if (request.filters.is_remote !== undefined) conditions.push(jsonBooleanEq(schema.catalogEntries.searchProjection, 'is_remote', request.filters.is_remote));
    if (request.filters.work_from_home_type) conditions.push(jsonTextEq(schema.catalogEntries.searchProjection, 'work_from_home_type', request.filters.work_from_home_type));
    if (request.filters.job_type) conditions.push(jsonTextEq(schema.catalogEntries.searchProjection, 'job_type', request.filters.job_type));
    if (request.filters.job_level) conditions.push(jsonTextEq(schema.catalogEntries.searchProjection, 'job_level', request.filters.job_level));
    if (request.filters.job_function) conditions.push(jsonTextEq(schema.catalogEntries.searchProjection, 'job_function', request.filters.job_function));
    if (request.filters.currency) conditions.push(jsonTextEq(schema.catalogEntries.searchProjection, 'currency', request.filters.currency));
    if (request.filters.salary_min !== undefined) conditions.push(jsonNumberGte(schema.catalogEntries.searchProjection, 'salary_max', request.filters.salary_min));
    if (request.filters.salary_max !== undefined) conditions.push(jsonNumberLte(schema.catalogEntries.searchProjection, 'salary_min', request.filters.salary_max));
    if (request.filters.date_posted_after) conditions.push(jsonTextGte(schema.catalogEntries.searchProjection, 'date_posted', request.filters.date_posted_after));
    if (request.filters.date_posted_before) conditions.push(jsonTextLte(schema.catalogEntries.searchProjection, 'date_posted', request.filters.date_posted_before));
    if (request.filters.has_salary !== undefined) conditions.push(jsonBooleanEq(schema.catalogEntries.searchProjection, 'has_salary', request.filters.has_salary));
    if (request.filters.has_direct_url !== undefined) conditions.push(jsonBooleanEq(schema.catalogEntries.searchProjection, 'has_direct_url', request.filters.has_direct_url));

    if (queryMode === 'keyword' && request.query.trim()) {
      conditions.push(ilike(schema.catalogEntries.searchText, `%${escapeLike(request.query)}%`));
    }
    if (request.cursor) {
      const cursor = decodeCursor(request.cursor);
      conditions.push(sql`(${schema.catalogEntries.updatedAt}, ${schema.catalogEntries.id}) < (${cursor.updatedAt}, ${cursor.id})`);
    }

    const query = this.db
      .select({
        entryId: schema.catalogEntries.id,
        commercialObjectId: schema.catalogEntries.commercialObjectId,
        title: schema.catalogEntries.title,
        summary: schema.catalogEntries.summary,
        providerId: schema.catalogEntries.providerId,
        objectId: schema.catalogEntries.objectId,
        objectType: schema.catalogEntries.objectType,
        searchText: schema.catalogEntries.searchText,
        projection: schema.catalogEntries.searchProjection,
        explainProjection: schema.catalogEntries.explainProjection,
        updatedAt: schema.catalogEntries.updatedAt,
      })
      .from(schema.catalogEntries)
      .where(and(...conditions));
    if (queryMode === 'keyword' && request.query.trim()) {
      return query.limit(Math.min(1_000, request.limit * 20 + 1));
    }
    return query.orderBy(desc(schema.catalogEntries.updatedAt)).limit(request.limit + 1);
  }
}

type JobQueryCursor = { updatedAt: string; id: string };

function encodeCursor(row: Pick<CandidateRow, 'updatedAt' | 'entryId'>) {
  return Buffer.from(JSON.stringify({ updatedAt: row.updatedAt.toISOString(), id: row.entryId } satisfies JobQueryCursor)).toString('base64url');
}

function decodeCursor(value: string): JobQueryCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object') throw new Error('cursor must be an object');
    const cursor = parsed as Record<string, unknown>;
    if (typeof cursor.updatedAt !== 'string' || Number.isNaN(Date.parse(cursor.updatedAt)) || typeof cursor.id !== 'string' || !cursor.id) {
      throw new Error('cursor fields are invalid');
    }
    return { updatedAt: cursor.updatedAt, id: cursor.id };
  } catch (error) {
    throw new AppError('validation_error', `Invalid cursor: ${error instanceof Error ? error.message : String(error)}`, 400);
  }
}

function selectQueryMode(request: JobQueryRequest): 'keyword' | 'filter' | 'semantic' | 'hybrid' {
  if (request.query_mode) return request.query_mode;
  if (request.query_pack === 'ocp.query.semantic.v1') return 'semantic';
  if (request.query_pack === 'ocp.query.filter.v1') return 'filter';
  if (request.query_pack === 'ocp.job.search.v1' && !request.query.trim()) return 'filter';
  if (request.query.trim()) return 'keyword';
  return 'filter';
}

function matchesFilters(projection: Record<string, unknown>, filters: JobFilters) {
  if (filters.company && normalize(projection.company) !== normalize(filters.company)) return false;
  if (filters.site && normalize(projection.site) !== normalize(filters.site)) return false;
  if (filters.location && !normalize(projection.location).includes(normalize(filters.location))) return false;
  if (filters.is_remote !== undefined && projection.is_remote !== filters.is_remote) return false;
  if (filters.work_from_home_type && normalize(projection.work_from_home_type) !== normalize(filters.work_from_home_type)) return false;
  if (filters.job_type && normalize(projection.job_type) !== normalize(filters.job_type)) return false;
  if (filters.job_level && normalize(projection.job_level) !== normalize(filters.job_level)) return false;
  if (filters.job_function && normalize(projection.job_function) !== normalize(filters.job_function)) return false;
  if (filters.currency && normalize(projection.currency) !== normalize(filters.currency)) return false;
  if (filters.has_salary !== undefined && projection.has_salary !== filters.has_salary) return false;
  if (filters.has_direct_url !== undefined && projection.has_direct_url !== filters.has_direct_url) return false;
  const salaryMin = numberValue(projection.salary_min);
  const salaryMax = numberValue(projection.salary_max);
  if (filters.salary_min !== undefined && (salaryMax === undefined || salaryMax < filters.salary_min)) return false;
  if (filters.salary_max !== undefined && (salaryMin === undefined || salaryMin > filters.salary_max)) return false;
  const datePosted = stringValue(projection.date_posted);
  if (filters.date_posted_after && (!datePosted || normalize(datePosted) < normalize(filters.date_posted_after))) return false;
  if (filters.date_posted_before && (!datePosted || normalize(datePosted) > normalize(filters.date_posted_before))) return false;
  return true;
}

function scoreProjection(projection: Record<string, unknown>, terms: string[], searchText: string) {
  const text = `${searchText} ${stringValue(projection.text) ?? ''}`.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (text.includes(term)) score += 1;
    if (normalize(projection.title).includes(term)) score += 3;
    if (normalize(projection.company).includes(term)) score += 2;
    if (normalize(projection.location).includes(term)) score += 1.5;
    if (normalize(projection.skills).includes(term)) score += 1.25;
  }
  return Number(score.toFixed(4));
}

function jobQualityScore(projection: Record<string, unknown>, filters: JobFilters) {
  let score = 0;
  if (stringValue(projection.apply_url)) score += 0.3;
  if (projection.has_direct_url === true) score += 0.15;
  if (projection.has_salary === true) score += 0.2;
  if (projection.is_remote === true) score += filters.is_remote ? 0.25 : 0.05;
  if (stringValue(projection.date_posted)) score += 0.1;
  if (stringValue(projection.skills)) score += 0.1;
  return score;
}

function buildItemExplain(projection: Record<string, unknown>, filters: JobFilters, terms: string[], keywordScore: number) {
  const explain: string[] = [];
  if (terms.length > 0) explain.push(`Keyword score ${keywordScore} from term(s): ${terms.join(', ')}.`);
  for (const [key, expected] of Object.entries(filters)) {
    if (expected !== undefined && expected !== false) explain.push(`Filter ${key} matched ${String(projection[key] ?? expected)}.`);
  }
  if (explain.length === 0) explain.push('Matched active job catalog entry.');
  return explain;
}

function visibleJobAttributes(projection: Record<string, unknown>) {
  const hidden = new Set(['text', 'job_url', 'job_url_direct', 'apply_url', 'source_url']);
  return Object.fromEntries(Object.entries(projection).filter(([key]) => !hidden.has(key)));
}

function tokenize(query: string) {
  return query.toLowerCase().split(/[\s,]+/).map((term) => term.trim()).filter(Boolean);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalize(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function hashKey(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function jsonTextEq(column: unknown, key: string, value: string) {
  return sql`lower(${column} ->> ${key}) = ${normalize(value)}`;
}

function jsonTextIlike(column: unknown, key: string, pattern: string) {
  return sql`${column} ->> ${key} ilike ${pattern} escape '\\'`;
}

function jsonTextGte(column: unknown, key: string, value: string) {
  return sql`${column} ->> ${key} >= ${value}`;
}

function jsonTextLte(column: unknown, key: string, value: string) {
  return sql`${column} ->> ${key} <= ${value}`;
}

function jsonBooleanEq(column: unknown, key: string, value: boolean) {
  return sql`(${column} ->> ${key})::boolean = ${value}`;
}

function jsonNumberGte(column: unknown, key: string, value: number) {
  return sql`(${column} ->> ${key})::double precision >= ${value}`;
}

function jsonNumberLte(column: unknown, key: string, value: number) {
  return sql`(${column} ->> ${key})::double precision <= ${value}`;
}

export const __jobQueryServiceTestOnly = {
  matchesFilters,
  scoreProjection,
  jobQualityScore,
  selectQueryMode,
};
