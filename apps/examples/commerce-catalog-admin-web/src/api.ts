export type CatalogAdminOverview = {
  catalog_id: string;
  catalog_name: string;
  semantic_search_enabled: boolean;
  query_packs: string[];
  metrics: {
    provider_count: number;
    object_count: number;
    active_entry_count: number;
    active_search_document_count: number;
    ready_embedding_count: number;
    pending_index_job_count: number;
    running_index_job_count: number;
    failed_index_job_count: number;
    query_audit_count: number;
    rich_entry_count: number;
    standard_entry_count: number;
    basic_entry_count: number;
    missing_image_count: number;
    missing_product_url_count: number;
    out_of_stock_count: number;
  };
  search_index: {
    active_document_count: number;
    ready_embedding_count: number;
    active_documents_missing_embedding_count: number;
    embedding_readiness_ratio: number;
    pending_job_count: number;
    running_job_count: number;
    failed_job_count: number;
    oldest_pending_job_created_at: string | null;
  };
  latest_sync_batch: {
    provider_id: string;
    status: string;
    accepted_count: number;
    rejected_count: number;
    created_at: string;
    finished_at: string | null;
  } | null;
};

export type CatalogAdminProvider = {
  provider_id: string;
  status: string;
  active_registration_version: number | null;
  guaranteed_fields: string[];
  declared_packs: string[];
  catalog_quality: {
    object_count: number;
    active_entry_count: number;
    rich_entry_count: number;
    standard_entry_count: number;
    basic_entry_count: number;
    out_of_stock_count: number;
    missing_image_count: number;
    missing_product_url_count: number;
  } | null;
  updated_at: string;
  latest_registration: {
    registration_version: number;
    status: string;
    updated_at: string;
  } | null;
  latest_sync_batch: {
    status: string;
    accepted_count: number;
    rejected_count: number;
    created_at: string;
  } | null;
};

export type CatalogAdminEntry = {
  entry_id: string;
  commercial_object_id: string;
  provider_id: string;
  object_id: string;
  object_type: string;
  entry_status: string;
  contract_match_status: string;
  title: string;
  summary: string | null;
  brand: string | null;
  category: string | null;
  currency: string | null;
  availability_status: string | null;
  search_projection: Record<string, unknown>;
  explain_projection: Record<string, unknown>;
  updated_at: string;
  raw_object: Record<string, unknown> | null;
  object_status: string | null;
  object_source_url: string | null;
  object_updated_at: string | null;
};

export type CatalogQueryItem = {
  entry_id: string;
  provider_id: string;
  object_id: string;
  title: string;
  summary?: string;
  score: number;
  attributes: Record<string, unknown>;
  explain: string[];
};

export type CatalogQueryResult = {
  result_count: number;
  page: {
    limit: number;
    offset: number;
    has_more: boolean;
    next_offset?: number;
  };
  items: CatalogQueryItem[];
  explain: string[];
};

export type ResolvedEntry = {
  id: string;
  catalog_id: string;
  entry_id: string;
  commercial_object_id: string;
  object_id: string;
  object_type: string;
  provider_id: string;
  title: string;
  visible_attributes: Record<string, unknown>;
  action_bindings: Array<{
    action_id: string;
    action_type: string;
    label: string;
    url: string;
    method: string;
  }>;
  freshness: {
    object_updated_at: string;
    resolved_at: string;
  };
  expires_at: string;
};

export type CatalogHealth = {
  ok: boolean;
  service: string;
  protocol: string;
};

export type CatalogManifest = Record<string, unknown>;
export type CatalogWellKnown = Record<string, unknown>;
export type CatalogContracts = Record<string, unknown>;

export type CenterCatalogRecord = {
  catalogId: string;
  verificationStatus: string;
  trustTier: string;
  healthStatus: string;
  activeSnapshotId: string | null;
  activeRegistrationVersion: number | null;
  updatedAt: string;
  wellKnownUrl: string;
  homepage: string;
  claimedDomains: string[];
};

export type CenterHealthRecord = {
  id: string;
  status: string;
  checkedUrl: string;
  latencyMs: number | null;
  error: string | null;
  createdAt: string;
};

export type CenterVerificationRecord = {
  id: string;
  challengeType: string;
  status: string;
  verifiedDomain: string | null;
  createdAt: string;
  verifiedAt: string | null;
  expiresAt: string | null;
  challengePayload: Record<string, unknown>;
};

export type CenterManifestSnapshot = {
  id: string;
  manifestUrl: string;
  discoveryPayload: Record<string, unknown>;
  manifestPayload: Record<string, unknown>;
  manifestHash: string;
  queryCapabilities: unknown[];
  createdAt: string;
};

export type CenterActionResult = Record<string, unknown> & {
  catalog_access_token?: string;
};

const catalogBaseUrl = resolveApiBaseUrl(
  'VITE_CATALOG_API_BASE_URL',
  import.meta.env.VITE_CATALOG_API_BASE_URL,
  'http://localhost:4000',
  window.location.origin,
);
const centerBaseUrl = resolveApiBaseUrl(
  'VITE_CENTER_API_BASE_URL',
  import.meta.env.VITE_CENTER_API_BASE_URL,
  'http://localhost:4100',
);
const adminPrefix = '/api/catalog-admin';

export async function fetchCatalogAdminOverview(apiKey: string) {
  return request<CatalogAdminOverview>(`${adminPrefix}/overview`, {
    method: 'GET',
    apiKey,
  });
}

export async function fetchCatalogAdminProviders(apiKey: string) {
  const payload = await request<{ catalog_id: string; providers: CatalogAdminProvider[] }>(`${adminPrefix}/providers`, {
    method: 'GET',
    apiKey,
  });
  return payload.providers;
}

export async function fetchCatalogAdminEntries(apiKey: string, filters?: {
  providerId?: string;
  entryStatus?: string;
  qualityTier?: string;
  search?: string;
}) {
  const params = new URLSearchParams();
  if (filters?.providerId) params.set('provider_id', filters.providerId);
  if (filters?.entryStatus) params.set('entry_status', filters.entryStatus);
  if (filters?.qualityTier) params.set('quality_tier', filters.qualityTier);
  if (filters?.search) params.set('search', filters.search);
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  const payload = await request<{ catalog_id: string; entries: CatalogAdminEntry[] }>(`${adminPrefix}/entries${suffix}`, {
    method: 'GET',
    apiKey,
  });
  return payload.entries;
}

export async function fetchCatalogHealth() {
  return request<CatalogHealth>(`${catalogBaseUrl}/health`, {
    method: 'GET',
  });
}

export async function fetchCatalogWellKnown() {
  return request<CatalogWellKnown>(`${catalogBaseUrl}/.well-known/ocp-catalog`, {
    method: 'GET',
  });
}

export async function fetchCatalogManifest() {
  return request<CatalogManifest>(`${catalogBaseUrl}/ocp/manifest`, {
    method: 'GET',
  });
}

export async function fetchCatalogContracts() {
  return request<CatalogContracts>(`${catalogBaseUrl}/ocp/contracts`, {
    method: 'GET',
  });
}

export async function runCatalogQuery(input: {
  catalogId: string;
  query: string;
  queryPack?: string;
  filters?: Record<string, unknown>;
  limit?: number;
  offset?: number;
  apiKey?: string;
}) {
  return request<CatalogQueryResult>(`${catalogBaseUrl}/ocp/query`, {
    method: 'POST',
    apiKey: input.apiKey,
    body: {
      ocp_version: '1.0',
      kind: 'CatalogQueryRequest',
      catalog_id: input.catalogId,
      query: input.query,
      query_pack: input.queryPack,
      filters: input.filters ?? {},
      limit: input.limit ?? 12,
      offset: input.offset ?? 0,
      explain: true,
    },
  });
}

export async function resolveCatalogEntry(input: {
  catalogId: string;
  entryId: string;
}) {
  return request<ResolvedEntry>(`${catalogBaseUrl}/ocp/resolve`, {
    method: 'POST',
    body: {
      ocp_version: '1.0',
      kind: 'ResolveRequest',
      catalog_id: input.catalogId,
      entry_id: input.entryId,
    },
  });
}

export async function fetchCenterCatalog(catalogId: string) {
  const payload = await request<Record<string, unknown>>(`${centerBaseUrl}/ocp/catalogs/${catalogId}`, {
    method: 'GET',
  });
  return mapCenterCatalog(payload);
}

export async function fetchCenterHealth(catalogId: string) {
  const payload = await request<{ center_id: string; catalog_id: string; checks: Record<string, unknown>[] }>(`${centerBaseUrl}/ocp/catalogs/${catalogId}/health`, {
    method: 'GET',
  });
  return {
    ...payload,
    checks: Array.isArray(payload.checks) ? payload.checks.map(mapCenterHealthRecord) : [],
  };
}

export async function fetchCenterVerification(catalogId: string) {
  const payload = await request<{ center_id: string; catalog_id: string; records: Record<string, unknown>[] }>(`${centerBaseUrl}/ocp/catalogs/${catalogId}/verification`, {
    method: 'GET',
  });
  return {
    ...payload,
    records: Array.isArray(payload.records) ? payload.records.map(mapCenterVerificationRecord) : [],
  };
}

export async function fetchCenterManifestSnapshot(catalogId: string) {
  const payload = await request<Record<string, unknown>>(`${centerBaseUrl}/ocp/catalogs/${catalogId}/manifest-snapshot`, {
    method: 'GET',
  });
  return mapCenterManifestSnapshot(payload);
}

export async function registerCatalogToCenter(apiKey: string) {
  return request<CenterActionResult>(`${adminPrefix}/center/register`, {
    method: 'POST',
    apiKey,
    body: {},
  });
}

export async function verifyCatalogInCenter(apiKey: string) {
  return request<CenterActionResult>(`${adminPrefix}/center/verify`, {
    method: 'POST',
    apiKey,
    body: {},
  });
}

export async function refreshCatalogInCenter(apiKey: string, catalogToken?: string) {
  return request<CenterActionResult>(`${adminPrefix}/center/refresh`, {
    method: 'POST',
    apiKey,
    body: {
      ...(catalogToken ? { catalog_token: catalogToken } : {}),
    },
  });
}

export async function rotateCatalogCenterToken(apiKey: string, catalogToken?: string) {
  return request<CenterActionResult>(`${adminPrefix}/center/token/rotate`, {
    method: 'POST',
    apiKey,
    body: {
      ...(catalogToken ? { catalog_token: catalogToken } : {}),
    },
  });
}

type RequestOptions = {
  method: 'GET' | 'POST';
  apiKey?: string;
  body?: unknown;
};

async function request<T>(url: string, options: RequestOptions): Promise<T> {
  const response = await fetch(url, {
    method: options.method,
    headers: {
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(options.apiKey ? { 'x-admin-key': options.apiKey } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `Request failed with status ${response.status}`);
  }

  return payload as T;
}

function resolveApiBaseUrl(
  envName: string,
  configuredValue: string | undefined,
  devDefault?: string,
  prodDefault?: string,
) {
  const value = configuredValue?.trim();
  if (value) return value.replace(/\/$/, '');
  if (import.meta.env.DEV && devDefault) return devDefault.replace(/\/$/, '');
  if (prodDefault) return prodDefault.replace(/\/$/, '');
  throw new Error(`${envName} must be configured for this deployment build.`);
}

function mapCenterCatalog(payload: Record<string, unknown>): CenterCatalogRecord {
  return {
    catalogId: pickString(payload, 'catalogId', 'catalog_id'),
    verificationStatus: pickString(payload, 'verificationStatus', 'verification_status'),
    trustTier: pickString(payload, 'trustTier', 'trust_tier'),
    healthStatus: pickString(payload, 'healthStatus', 'health_status'),
    activeSnapshotId: pickNullableString(payload, 'activeSnapshotId', 'active_snapshot_id'),
    activeRegistrationVersion: pickNullableNumber(payload, 'activeRegistrationVersion', 'active_registration_version'),
    updatedAt: pickTimestamp(payload, 'updatedAt', 'updated_at'),
    wellKnownUrl: pickString(payload, 'wellKnownUrl', 'well_known_url'),
    homepage: pickString(payload, 'homepage'),
    claimedDomains: pickStringArray(payload, 'claimedDomains', 'claimed_domains'),
  };
}

function mapCenterHealthRecord(payload: Record<string, unknown>): CenterHealthRecord {
  return {
    id: pickString(payload, 'id'),
    status: pickString(payload, 'status'),
    checkedUrl: pickString(payload, 'checkedUrl', 'checked_url'),
    latencyMs: pickNullableNumber(payload, 'latencyMs', 'latency_ms'),
    error: pickNullableString(payload, 'error'),
    createdAt: pickTimestamp(payload, 'createdAt', 'created_at', 'checkedAt', 'checked_at'),
  };
}

function mapCenterVerificationRecord(payload: Record<string, unknown>): CenterVerificationRecord {
  return {
    id: pickString(payload, 'id'),
    challengeType: pickString(payload, 'challengeType', 'challenge_type'),
    status: pickString(payload, 'status'),
    verifiedDomain: pickNullableString(payload, 'verifiedDomain', 'verified_domain'),
    createdAt: pickTimestamp(payload, 'createdAt', 'created_at'),
    verifiedAt: pickNullableTimestamp(payload, 'verifiedAt', 'verified_at'),
    expiresAt: pickNullableTimestamp(payload, 'expiresAt', 'expires_at'),
    challengePayload: pickRecord(payload, 'challengePayload', 'challenge_payload'),
  };
}

function mapCenterManifestSnapshot(payload: Record<string, unknown>): CenterManifestSnapshot {
  return {
    id: pickString(payload, 'id'),
    manifestUrl: pickString(payload, 'manifestUrl', 'manifest_url'),
    discoveryPayload: pickRecord(payload, 'discoveryPayload', 'discovery_payload'),
    manifestPayload: pickRecord(payload, 'manifestPayload', 'manifest_payload'),
    manifestHash: pickString(payload, 'manifestHash', 'manifest_hash'),
    queryCapabilities: pickArray(payload, 'queryCapabilities', 'query_capabilities'),
    createdAt: pickTimestamp(payload, 'createdAt', 'created_at'),
  };
}

function pickString(source: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string') return value;
  }
  return '';
}

function pickNullableString(source: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (value == null) return null;
    if (typeof value === 'string') return value;
  }
  return null;
}

function pickNullableNumber(source: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (value == null) return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function pickStringArray(source: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  }
  return [];
}

function pickArray(source: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function pickRecord(source: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (isRecord(value)) return value;
  }
  return {};
}

function pickTimestamp(source: Record<string, unknown>, ...keys: string[]) {
  return pickNullableTimestamp(source, ...keys) ?? '';
}

function pickNullableTimestamp(source: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (value == null) return null;
    if (typeof value === 'string') return value;
    if (value instanceof Date) return value.toISOString();
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
