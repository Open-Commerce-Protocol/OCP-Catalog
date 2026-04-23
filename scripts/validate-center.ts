const centerBaseUrl = (process.env.CENTER_PUBLIC_BASE_URL ?? 'http://localhost:4100').replace(/\/$/, '');
const catalogBaseUrl = (process.env.CATALOG_PUBLIC_BASE_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const centerId = process.env.CENTER_ID ?? 'center_local_dev';
const catalogId = process.env.CATALOG_ID ?? 'cat_local_dev';
const registrationVersion = Math.floor(Date.now() / 1000);

const checks: string[] = [];
let catalogToken = '';

await check('Center health', async () => {
  const health = await get(`${centerBaseUrl}/health`);
  assert(health.ok === true, 'center health should be ok');
});

await check('Center discovery and manifest', async () => {
  const discovery = await get(`${centerBaseUrl}/.well-known/ocp-center`);
  assert(discovery.center_id === centerId, 'center_id should match');
  const manifest = await get(discovery.manifest_url);
  assert(manifest.kind === 'CenterManifest', 'center manifest kind should match');
});

await check('Catalog node discovery is reachable', async () => {
  const discovery = await get(`${catalogBaseUrl}/.well-known/ocp-catalog`);
  assert(discovery.catalog_id === catalogId, 'catalog node discovery catalog_id should match');
});

await check('Catalog registration indexes local catalog', async () => {
  const result = await post(`${centerBaseUrl}/ocp/catalogs/register`, {
    ocp_version: '1.0',
    kind: 'CatalogRegistration',
    id: `catreg_${catalogId}_${registrationVersion}`,
    center_id: centerId,
    catalog_id: catalogId,
    registration_version: registrationVersion,
    updated_at: new Date().toISOString(),
    homepage: catalogBaseUrl,
    well_known_url: `${catalogBaseUrl}/.well-known/ocp-catalog`,
    claimed_domains: ['localhost'],
    operator: {
      operator_id: 'local_dev_operator',
      display_name: 'Local Dev Catalog Operator',
      contact_email: 'ops@example.test',
    },
    intended_visibility: 'public',
    tags: ['local', 'commerce', 'product'],
  });
  assert(result.status === 'accepted_indexed', `expected accepted_indexed, got ${result.status}`);
  assert(result.indexed === true, 'registration should be indexed');
  assert(result.catalog_access_token, 'indexed registration should issue catalog token');
  catalogToken = result.catalog_access_token;
});

await check('Catalog search returns route hint', async () => {
  const result = await post(`${centerBaseUrl}/ocp/catalogs/search`, {
    ocp_version: '1.0',
    kind: 'CatalogSearchRequest',
    query: 'commerce product',
    filters: {
      supports_resolve: true,
      verification_status: 'not_required',
    },
    limit: 10,
    explain: true,
  });
  const item = result.items.find((candidate: any) => candidate.catalog_id === catalogId);
  assert(item, 'search should return local catalog');
  assert(item.route_hint.query_url, 'route hint should include query_url');
  assert(item.route_hint.manifest_url, 'route hint should include manifest_url');
  assert(item.explain.length > 0, 'item explain should be present');
});

await check('Catalog resolve returns route hint by catalog_id', async () => {
  const routeHint = await post(`${centerBaseUrl}/ocp/catalogs/resolve`, {
    ocp_version: '1.0',
    kind: 'CatalogResolveRequest',
    catalog_id: catalogId,
  });
  assert(routeHint.catalog_id === catalogId, 'resolved route hint should match catalog_id');
  assert(typeof routeHint.query_url === 'string' && routeHint.query_url.length > 0, 'route hint should include query_url');
});

await check('Catalog refresh requires token', async () => {
  const response = await fetch(`${centerBaseUrl}/ocp/catalogs/${catalogId}/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  });
  assert(response.status === 401, `refresh without token should return 401, got ${response.status}`);
});

await check('Catalog refresh accepts catalog-specific token', async () => {
  const result = await post(`${centerBaseUrl}/ocp/catalogs/${catalogId}/refresh`, {}, {
    'x-catalog-token': catalogToken,
  });
  assert(result.status === 'refreshed', `expected refreshed, got ${result.status}`);
  assert(result.snapshot_id, 'refresh should create snapshot');
});

await check('Catalog token rotation invalidates old token', async () => {
  const rotated = await post(`${centerBaseUrl}/ocp/catalogs/${catalogId}/token/rotate`, {}, {
    'x-catalog-token': catalogToken,
  });
  assert(rotated.catalog_access_token, 'rotation should return new token');
  const oldResponse = await fetch(`${centerBaseUrl}/ocp/catalogs/${catalogId}/refresh`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-catalog-token': catalogToken,
    },
    body: JSON.stringify({}),
  });
  assert(oldResponse.status === 401, `old token should be rejected, got ${oldResponse.status}`);
  catalogToken = rotated.catalog_access_token;
});

console.log(`\nCenter validation passed (${checks.length} checks).`);
for (const label of checks) console.log(`- ${label}`);

async function check(label: string, fn: () => Promise<void>) {
  try {
    await fn();
    checks.push(label);
    console.log(`ok - ${label}`);
  } catch (error) {
    console.error(`failed - ${label}`);
    throw error;
  }
}

async function get(url: string) {
  const response = await fetch(url);
  return parse(response);
}

async function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return parse(response);
}

async function parse(response: Response) {
  const payload = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${JSON.stringify(payload)}`);
  return payload;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
