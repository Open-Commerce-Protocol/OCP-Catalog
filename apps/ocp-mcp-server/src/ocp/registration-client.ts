import {
  catalogRouteHintSchema,
  catalogSearchResultSchema,
  type CatalogRouteHint,
  type CatalogSearchRequest,
  type CatalogSearchResult,
} from '@ocp-catalog/registration-schema';
import { fetchJson } from './http';

export class RegistrationClient {
  constructor(
    private readonly options: {
      timeoutMs: number;
      userAgent: string;
    },
  ) {}

  async search(baseUrl: string, body: CatalogSearchRequest): Promise<CatalogSearchResult> {
    const payload = await fetchJson<unknown>(
      `${trimTrailingSlash(baseUrl)}/ocp/catalogs/search`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      {
        timeoutMs: this.options.timeoutMs,
        userAgent: this.options.userAgent,
        unavailableCode: 'registration_unavailable',
      },
    );

    return catalogSearchResultSchema.parse(normalizeLegacyCatalogSearchResult(payload));
  }

  async resolve(baseUrl: string, catalogId: string): Promise<CatalogRouteHint> {
    const payload = await fetchJson<unknown>(
      `${trimTrailingSlash(baseUrl)}/ocp/catalogs/resolve`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ocp_version: '1.0',
          kind: 'CatalogResolveRequest',
          catalog_id: catalogId,
        }),
      },
      {
        timeoutMs: this.options.timeoutMs,
        userAgent: this.options.userAgent,
        unavailableCode: 'registration_unavailable',
      },
    );

    return catalogRouteHintSchema.parse(payload);
  }
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function normalizeLegacyCatalogSearchResult(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const record = payload as Record<string, unknown>;
  if (record.registration_id || typeof record.center_id !== 'string') return payload;

  return {
    ...record,
    registration_id: record.center_id,
  };
}
