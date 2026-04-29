import {
  catalogManifestSchema,
  catalogQueryResultSchema,
  resolvableReferenceSchema,
  type CatalogManifest,
  type CatalogQueryRequest,
  type CatalogQueryResult,
  type ResolveRequest,
  type ResolvableReference,
} from '@ocp-catalog/ocp-schema';
import { fetchJson } from './http';

export class CatalogClient {
  constructor(
    private readonly options: {
      timeoutMs: number;
      userAgent: string;
    },
  ) {}

  async getManifest(manifestUrl: string): Promise<CatalogManifest> {
    const payload = await fetchJson<unknown>(
      manifestUrl,
      { method: 'GET' },
      {
        timeoutMs: this.options.timeoutMs,
        userAgent: this.options.userAgent,
        unavailableCode: 'catalog_manifest_unavailable',
      },
    );

    return catalogManifestSchema.parse(payload);
  }

  async query(queryUrl: string, body: CatalogQueryRequest, apiKey?: string): Promise<CatalogQueryResult> {
    const payload = await fetchJson<unknown>(
      queryUrl,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(apiKey ? { 'x-api-key': apiKey } : {}),
        },
        body: JSON.stringify(body),
      },
      {
        timeoutMs: this.options.timeoutMs,
        userAgent: this.options.userAgent,
        unavailableCode: 'catalog_query_failed',
      },
    );

    return catalogQueryResultSchema.parse(normalizeCatalogQueryResult(payload, body));
  }

  async resolve(resolveUrl: string, body: ResolveRequest): Promise<ResolvableReference> {
    const payload = await fetchJson<unknown>(
      resolveUrl,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      {
        timeoutMs: this.options.timeoutMs,
        userAgent: this.options.userAgent,
        unavailableCode: 'catalog_resolve_failed',
      },
    );

    return resolvableReferenceSchema.parse(payload);
  }
}

function normalizeCatalogQueryResult(payload: unknown, request: CatalogQueryRequest) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const record = payload as Record<string, unknown>;
  if (record.page) return payload;

  const limit = request.limit ?? 20;
  const offset = request.offset ?? 0;
  const items = Array.isArray(record.items) ? record.items : [];
  const resultCount = typeof record.result_count === 'number' ? record.result_count : items.length;
  const nextOffset = offset + items.length;
  const hasMore = nextOffset < resultCount;

  return {
    ...record,
    page: {
      limit,
      offset,
      has_more: hasMore,
      ...(hasMore ? { next_offset: nextOffset } : {}),
    },
  };
}
