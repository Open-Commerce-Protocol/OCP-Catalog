export type CatalogAdminOverview = {
  catalog_id: string;
  catalog_name: string;
  semantic_search_enabled: boolean;
  query_packs: string[];
  metrics: {
    provider_count: number;
    object_count: number;
    active_entry_count: number;
    query_audit_count: number;
    rich_entry_count: number;
    standard_entry_count: number;
    basic_entry_count: number;
    missing_image_count: number;
    missing_product_url_count: number;
    out_of_stock_count: number;
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
  return request<CenterCatalogRecord>(`${centerBaseUrl}/ocp/catalogs/${catalogId}`, {
    method: 'GET',
  });
}

export async function fetchCenterHealth(catalogId: string) {
  return request<{ center_id: string; catalog_id: string; checks: CenterHealthRecord[] }>(`${centerBaseUrl}/ocp/catalogs/${catalogId}/health`, {
    method: 'GET',
  });
}

export async function fetchCenterVerification(catalogId: string) {
  return request<{ center_id: string; catalog_id: string; records: CenterVerificationRecord[] }>(`${centerBaseUrl}/ocp/catalogs/${catalogId}/verification`, {
    method: 'GET',
  });
}

export async function fetchCenterManifestSnapshot(catalogId: string) {
  return request<CenterManifestSnapshot>(`${centerBaseUrl}/ocp/catalogs/${catalogId}/manifest-snapshot`, {
    method: 'GET',
  });
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
