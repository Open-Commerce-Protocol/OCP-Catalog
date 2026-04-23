export type CenterOverview = {
  center_id: string;
  center_name: string;
  refresh_scheduler_enabled: boolean;
  refresh_interval_seconds: number;
  metrics: {
    registered_catalog_count: number;
    indexed_catalog_count: number;
    verified_catalog_count: number;
    healthy_catalog_count: number;
    challenge_required_count: number;
    verification_record_count: number;
    health_check_count: number;
    search_audit_count: number;
  };
  latest_search_audit: {
    id: string;
    created_at: string;
    result_count: number;
    request_payload: Record<string, unknown>;
  } | null;
};

export type CenterCatalogListItem = {
  catalog_id: string;
  homepage: string;
  well_known_url: string;
  claimed_domains: string[];
  verification_status: string;
  health_status: string;
  trust_tier: string;
  status: string;
  active_registration_version: number | null;
  active_snapshot_id: string | null;
  updated_at: string;
  created_at: string;
  token_issued_at: string | null;
  registration_count: number;
  latest_health_check: {
    status: string;
    checked_at: string;
    checked_url: string;
    latency_ms: number | null;
    error: string | null;
  } | null;
  latest_verification: {
    status: string;
    challenge_type: string;
    created_at: string;
    verified_at: string | null;
    verified_domain: string | null;
  } | null;
};

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

export type CenterRegistrationRecord = {
  id: string;
  registration_version: number;
  status: string;
  created_at: string;
  source_ip: string | null;
  user_agent: string | null;
  registration_payload: Record<string, unknown>;
  result_payload: Record<string, unknown> | null;
};

export type CenterSearchAudit = {
  id: string;
  created_at: string;
  result_count: number;
  requester_key_hash: string | null;
  request_payload: Record<string, unknown>;
};

const centerBaseUrl = resolveApiBaseUrl(
  import.meta.env.VITE_CENTER_API_BASE_URL,
  'http://localhost:4100',
  resolveCenterApiProdDefault(),
);
const centerAdminBaseUrl = `${centerBaseUrl}/api/center-admin`;

export async function fetchCenterAdminOverview(apiKey: string) {
  return request<CenterOverview>(`${centerAdminBaseUrl}/overview`, { method: 'GET', apiKey });
}

export async function fetchCenterAdminCatalogs(apiKey: string) {
  const payload = await request<{ center_id: string; catalogs: CenterCatalogListItem[] }>(`${centerAdminBaseUrl}/catalogs`, { method: 'GET', apiKey });
  return Array.isArray(payload.catalogs) ? payload.catalogs : [];
}

export async function fetchCenterAdminRegistrations(apiKey: string, catalogId: string) {
  const payload = await request<{ center_id: string; catalog_id: string; registrations: CenterRegistrationRecord[] }>(
    `${centerAdminBaseUrl}/catalogs/${catalogId}/registrations`,
    { method: 'GET', apiKey },
  );
  return Array.isArray(payload.registrations) ? payload.registrations : [];
}

export async function fetchCenterAdminSearchAudits(apiKey: string) {
  const payload = await request<{ center_id: string; audits: CenterSearchAudit[] }>(`${centerAdminBaseUrl}/search-audits`, { method: 'GET', apiKey });
  return Array.isArray(payload.audits) ? payload.audits : [];
}

export async function fetchCenterCatalog(catalogId: string) {
  const payload = await request<Record<string, unknown>>(`${centerBaseUrl}/ocp/catalogs/${catalogId}`, { method: 'GET' });
  return mapCenterCatalog(payload);
}

export async function fetchCenterHealth(catalogId: string) {
  const payload = await request<{ checks: Record<string, unknown>[] }>(`${centerBaseUrl}/ocp/catalogs/${catalogId}/health`, { method: 'GET' });
  return Array.isArray(payload.checks) ? payload.checks.map(mapCenterHealthRecord) : [];
}

export async function fetchCenterVerification(catalogId: string) {
  const payload = await request<{ records: Record<string, unknown>[] }>(`${centerBaseUrl}/ocp/catalogs/${catalogId}/verification`, { method: 'GET' });
  return Array.isArray(payload.records) ? payload.records.map(mapCenterVerificationRecord) : [];
}

export async function fetchCenterManifestSnapshot(catalogId: string) {
  const payload = await request<Record<string, unknown>>(`${centerBaseUrl}/ocp/catalogs/${catalogId}/manifest-snapshot`, { method: 'GET' });
  return mapCenterManifestSnapshot(payload);
}

export async function verifyCenterCatalog(catalogId: string) {
  return request<Record<string, unknown>>(`${centerBaseUrl}/ocp/catalogs/${catalogId}/verify`, {
    method: 'POST',
    body: {},
  });
}

export async function refreshCenterCatalog(catalogId: string, catalogToken?: string) {
  return request<Record<string, unknown>>(`${centerBaseUrl}/ocp/catalogs/${catalogId}/refresh`, {
    method: 'POST',
    body: {},
    catalogToken,
  });
}

export async function rotateCenterCatalogToken(catalogId: string, catalogToken?: string) {
  return request<Record<string, unknown>>(`${centerBaseUrl}/ocp/catalogs/${catalogId}/token/rotate`, {
    method: 'POST',
    body: {},
    catalogToken,
  });
}

type RequestOptions = {
  method: 'GET' | 'POST';
  apiKey?: string;
  body?: unknown;
  catalogToken?: string;
};

async function request<T>(url: string, options: RequestOptions): Promise<T> {
  const response = await fetch(url, {
    method: options.method,
    headers: {
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(options.apiKey ? { 'x-admin-key': options.apiKey } : {}),
      ...(options.catalogToken ? { 'x-catalog-token': options.catalogToken } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });

  const text = await response.text();
  let payload: unknown = {};
  if (text.trim()) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`Expected JSON response from ${url}, received non-JSON content`);
    }
  }
  if (!response.ok) {
    throw new Error((payload as { error?: { message?: string } })?.error?.message ?? `Request failed with status ${response.status}`);
  }

  return payload as T;
}

function resolveApiBaseUrl(configuredValue: string | undefined, devDefault: string, prodDefault: string) {
  const value = configuredValue?.trim();
  if (value) return value.replace(/\/$/, '');
  if (import.meta.env.DEV) return devDefault.replace(/\/$/, '');
  return prodDefault.replace(/\/$/, '');
}

function resolveCenterApiProdDefault() {
  const deployedUnderCenterPrefix = window.location.pathname === '/api/center' || window.location.pathname.startsWith('/api/center/');
  return `${window.location.origin}${deployedUnderCenterPrefix ? '/api/center' : ''}`;
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
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
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
