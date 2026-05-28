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
import {
  catalogRouteHintSchema,
  catalogSearchResultSchema,
  registrationDiscoverySchema,
  type CatalogRouteHint,
  type CatalogSearchRequest,
  type CatalogSearchResult,
  type RegistrationDiscovery,
} from '@ocp-catalog/registration-schema';
import {
  ocpActivityEventInputSchema,
  type OcpActivityClientKind,
  type OcpActivityEventInput,
  type OcpActivityProtocolFamily,
  type OcpActivityPublicVisibility,
  type OcpActivitySourceKind,
} from '@ocp-catalog/ocp-activity-schema';

export type OcpClientActivityMetadata = Record<string, string | number | boolean | null>;
export type OcpClientActivitySink = (event: OcpActivityEventInput) => void | Promise<void>;
export type OcpClientCorrelationId = string | (() => string | undefined);

export type OcpClientActivityOptions = {
  apiUrl?: string;
  apiKey?: string;
  sink?: OcpClientActivitySink;
  sourceKind?: OcpActivitySourceKind;
  clientKind?: OcpActivityClientKind;
  sourceName?: string;
  clientName?: string;
  publicVisibility?: OcpActivityPublicVisibility;
  correlationId?: OcpClientCorrelationId;
  includeClientCorrelationId?: boolean;
  metadata?: OcpClientActivityMetadata;
  timeoutMs?: number;
};

export type OcpClientOptions = {
  timeoutMs?: number;
  userAgent?: string;
  apiKey?: string;
  correlationId?: OcpClientCorrelationId;
  activity?: OcpClientActivityOptions;
};

type FetchJsonContext = {
  protocolFamily: OcpActivityProtocolFamily;
  pathTemplate?: string;
  metadata?: OcpClientActivityMetadata;
  queryPack?: string;
  catalogId?: string;
};

export class OcpClientError extends Error {
  constructor(
    message: string,
    public readonly details: {
      url: string;
      status?: number;
      payload?: unknown;
      cause?: string;
    },
  ) {
    super(message);
    this.name = 'OcpClientError';
  }
}

export class OcpClient {
  constructor(private readonly options: OcpClientOptions = {}) {}

  async discoverRegistration(discoveryUrl: string): Promise<RegistrationDiscovery> {
    const payload = await this.fetchJson(discoveryUrl, { method: 'GET' }, {
      protocolFamily: 'registration',
    });
    return registrationDiscoverySchema.parse(payload);
  }

  async searchCatalogs(registrationBaseUrl: string, body: CatalogSearchRequest): Promise<CatalogSearchResult> {
    const payload = await this.fetchJson(`${trimTrailingSlash(registrationBaseUrl)}/ocp/catalogs/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }, {
      protocolFamily: 'registration',
      pathTemplate: '/ocp/catalogs/search',
    });
    return catalogSearchResultSchema.parse(payload);
  }

  async resolveCatalogRoute(registrationBaseUrl: string, catalogId: string): Promise<CatalogRouteHint> {
    const payload = await this.fetchJson(`${trimTrailingSlash(registrationBaseUrl)}/ocp/catalogs/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ocp_version: '1.0',
        kind: 'CatalogResolveRequest',
        catalog_id: catalogId,
      }),
    }, {
      protocolFamily: 'registration',
      pathTemplate: '/ocp/catalogs/resolve',
      catalogId,
    });
    return catalogRouteHintSchema.parse(payload);
  }

  async inspectCatalog(manifestUrl: string): Promise<CatalogManifest> {
    const payload = await this.fetchJson(manifestUrl, { method: 'GET' }, {
      protocolFamily: 'catalog',
    });
    return catalogManifestSchema.parse(payload);
  }

  async queryCatalog(queryUrl: string, body: CatalogQueryRequest): Promise<CatalogQueryResult> {
    const payload = await this.fetchJson(queryUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }, {
      protocolFamily: 'catalog',
      queryPack: body.query_pack,
      catalogId: body.catalog_id,
      metadata: {
        request_limit: body.limit ?? null,
        request_offset: body.offset ?? null,
      },
    });
    return catalogQueryResultSchema.parse(normalizeCatalogQueryResult(payload, body));
  }

  async resolveCatalogEntry(resolveUrl: string, body: ResolveRequest): Promise<ResolvableReference> {
    const payload = await this.fetchJson(resolveUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }, {
      protocolFamily: 'catalog',
      catalogId: body.catalog_id,
      metadata: {
        resolve_purpose: body.purpose ?? null,
      },
    });
    return resolvableReferenceSchema.parse(payload);
  }

  async ingestActivityEvent(activityUrl: string, body: OcpActivityEventInput) {
    const event = ocpActivityEventInputSchema.parse(body);
    return this.fetchJson(`${trimTrailingSlash(activityUrl)}/ocp/audit/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
    });
  }

  async listActivityEvents(activityUrl: string, limit = 50) {
    return this.fetchJson(`${trimTrailingSlash(activityUrl)}/api/activity/recent?limit=${encodeURIComponent(String(limit))}`, {
      method: 'GET',
    });
  }

  private async fetchJson(url: string, init: RequestInit, context?: FetchJsonContext): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 10_000);
    const method = normalizeHttpMethod(init.method);
    const startedAt = Date.now();
    let statusCode: number | undefined;
    let errorCode: string | undefined;

    try {
      const headers = new Headers(init.headers);
      if (this.options.userAgent) headers.set('user-agent', this.options.userAgent);
      if (this.options.apiKey && !headers.has('x-api-key')) headers.set('x-api-key', this.options.apiKey);
      const traceId = resolveCorrelationId(this.options.correlationId);
      if (traceId) headers.set('x-ocp-trace-id', traceId);

      this.recordClientCall('client.call_attempted', url, method, context);

      const response = await fetch(url, {
        ...init,
        headers,
        signal: controller.signal,
      });
      statusCode = response.status;
      const text = await response.text();
      const payload = text ? JSON.parse(text) : null;

      if (!response.ok) {
        errorCode = 'http_error';
        throw new OcpClientError(`HTTP ${response.status} from ${url}`, {
          url,
          status: response.status,
          payload,
        });
      }

      return payload;
    } catch (error) {
      if (error instanceof OcpClientError) throw error;
      errorCode = classifyClientError(error);
      throw new OcpClientError(`Failed to fetch ${url}`, {
        url,
        cause: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.recordClientCall('client.call_completed', url, method, context, {
        statusCode,
        durationMs: Date.now() - startedAt,
        errorCode,
      });
      clearTimeout(timeout);
    }
  }

  private recordClientCall(
    eventType: 'client.call_attempted' | 'client.call_completed',
    url: string,
    method: string,
    context: FetchJsonContext | undefined,
    result: { statusCode?: number; durationMs?: number; errorCode?: string } = {},
  ) {
    const activity = this.options.activity;
    if (!activity || (!activity.sink && !activity.apiUrl) || !context) return;

    const metadata = sanitizeActivityMetadata({
      ...activity.metadata,
      ...safeIdentityMetadata(activity),
      ...safeUrlMetadata(url),
      ...context.metadata,
    });
    const event = compactActivityEvent({
      event_type: eventType,
      occurred_at: new Date().toISOString(),
      correlation_id: resolveActivityCorrelationId(activity, this.options.correlationId),
      source_kind: activity.sourceKind ?? 'unknown',
      client_kind: activity.clientKind ?? 'http',
      endpoint_role: 'outbound',
      protocol_family: context.protocolFamily,
      method,
      path_template: context.pathTemplate ?? safeUrlPath(url),
      status_code: result.statusCode,
      duration_ms: result.durationMs,
      error_code: result.errorCode,
      catalog_id: context.catalogId,
      query_pack: context.queryPack,
      public_visibility: activity.publicVisibility ?? 'aggregate_only',
      metadata,
    });

    this.emitActivityEvent(event);
  }

  private emitActivityEvent(input: OcpActivityEventInput) {
    const activity = this.options.activity;
    if (!activity) return;

    let event: OcpActivityEventInput;
    try {
      event = ocpActivityEventInputSchema.parse(input);
    } catch {
      return;
    }

    const pending: Promise<unknown>[] = [];
    if (activity.sink) {
      try {
        const result = activity.sink(event);
        if (isPromiseLike(result)) pending.push(result);
      } catch {
        // Activity instrumentation is intentionally best-effort.
      }
    }

    if (activity.apiUrl) {
      pending.push(sendActivityEvent(activity, event));
    }

    if (pending.length > 0) {
      void Promise.allSettled(pending);
    }
  }
}

export function createCorrelationId(prefix = 'corr') {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function resolveCorrelationId(value: OcpClientCorrelationId | undefined) {
  return typeof value === 'function' ? value() : value;
}

function resolveActivityCorrelationId(activity: OcpClientActivityOptions, clientCorrelationId: OcpClientCorrelationId | undefined) {
  if (activity.correlationId !== undefined) return resolveCorrelationId(activity.correlationId);
  if (activity.includeClientCorrelationId === false) return undefined;
  return resolveCorrelationId(clientCorrelationId);
}

function normalizeHttpMethod(method: string | undefined) {
  return (method ?? 'GET').toUpperCase();
}

function safeUrlPath(value: string) {
  try {
    const path = new URL(value).pathname || '/';
    return truncateActivityString(path, 200);
  } catch {
    return undefined;
  }
}

function safeUrlMetadata(value: string): OcpClientActivityMetadata {
  try {
    const url = new URL(value);
    return {
      endpoint_scheme: url.protocol.replace(/:$/, ''),
      endpoint_host: url.host,
    };
  } catch {
    return {};
  }
}

function safeIdentityMetadata(activity: OcpClientActivityOptions): OcpClientActivityMetadata {
  return {
    ...(activity.sourceName ? { source_name: activity.sourceName } : {}),
    ...(activity.clientName ? { client_name: activity.clientName } : {}),
  };
}

function sanitizeActivityMetadata(metadata: OcpClientActivityMetadata): OcpClientActivityMetadata {
  const result: OcpClientActivityMetadata = {};
  for (const [key, value] of Object.entries(metadata).slice(0, 24)) {
    if (value === undefined) continue;
    result[truncateActivityString(key, 80)] = typeof value === 'string' ? truncateActivityString(value, 500) : value;
  }
  return result;
}

function compactActivityEvent(event: OcpActivityEventInput): OcpActivityEventInput {
  return Object.fromEntries(Object.entries(event).filter(([, value]) => value !== undefined)) as OcpActivityEventInput;
}

function truncateActivityString(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function classifyClientError(error: unknown) {
  if (error instanceof SyntaxError) return 'invalid_json';
  if (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError') return 'timeout';
  if (error instanceof Error && error.name === 'AbortError') return 'timeout';
  return 'fetch_error';
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return !!value && typeof value === 'object' && 'then' in value && typeof (value as { then?: unknown }).then === 'function';
}

async function sendActivityEvent(activity: OcpClientActivityOptions, event: OcpActivityEventInput) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), activity.timeoutMs ?? 2_000);

  try {
    const headers = new Headers({ 'content-type': 'application/json' });
    if (activity.apiKey) headers.set('x-api-key', activity.apiKey);

    await fetch(activityIngestUrl(activity.apiUrl ?? ''), {
      method: 'POST',
      headers,
      body: JSON.stringify(event),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function activityIngestUrl(apiUrl: string) {
  const trimmed = trimTrailingSlash(apiUrl);
  return trimmed.endsWith('/ocp/audit/events') ? trimmed : `${trimmed}/ocp/audit/events`;
}

function normalizeCatalogQueryResult(payload: unknown, request: CatalogQueryRequest) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const record = payload as Record<string, unknown>;
  if (record.page) return payload;

  const limit = request.limit ?? 20;
  const offset = request.offset ?? 0;
  const entries = Array.isArray(record.entries) ? record.entries : [];
  const resultCount = typeof record.result_count === 'number' ? record.result_count : entries.length;
  const nextOffset = offset + entries.length;
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
