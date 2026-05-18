// End-to-end validation that exercises the full integration path:
//   1. Shopify catalog bridge serves OCP discovery / manifest / health
//   2. Shopify catalog registers itself with the registration center
//   3. Registration center's search returns the Shopify catalog
//   4. Registration center's resolve returns a route hint with query_url
//   5. Caller follows the route hint and runs /ocp/query + /ocp/resolve
//      directly against the Shopify catalog
//
// Prereqs (in separate terminals):
//   bun run --cwd packages/db migrate
//   bun run registration:api     # http://localhost:4100
//   bun run shopify:catalog:api  # http://localhost:4320
//   # SHOPIFY_MOCK=true is the default, no Shopify creds needed.

const registrationBaseUrl = (process.env.REGISTRATION_PUBLIC_BASE_URL ?? 'http://localhost:4100').replace(/\/$/, '');
const shopifyBaseUrl = (process.env.SHOPIFY_CATALOG_PUBLIC_BASE_URL ?? 'http://localhost:4320').replace(/\/$/, '');
const registrationId = process.env.REGISTRATION_ID ?? 'registration_local_dev';
const shopifyCatalogId = process.env.SHOPIFY_CATALOG_ID ?? 'cat_shopify_global';
const registrationVersion = Math.floor(Date.now() / 1000);

const checks: string[] = [];
let routeQueryUrl = '';
let routeResolveUrl = '';

await check('Shopify catalog is reachable and exposes OCP discovery', async () => {
  const discovery = await get(`${shopifyBaseUrl}/.well-known/ocp-catalog`);
  assert(discovery.catalog_id === shopifyCatalogId, `discovery.catalog_id should be ${shopifyCatalogId}, got ${discovery.catalog_id}`);
  assert(typeof discovery.manifest_url === 'string', 'discovery.manifest_url should be present');
});

await check('Shopify catalog manifest validates against OCP schema (registration center fetches this)', async () => {
  const manifest = await get(`${shopifyBaseUrl}/ocp/manifest`);
  assert(manifest.kind === 'CatalogManifest', 'manifest kind must be CatalogManifest');
  assert(manifest.catalog_id === shopifyCatalogId, 'manifest.catalog_id mismatch');
  assert(manifest.endpoints?.query?.url, 'manifest.endpoints.query required');
  assert(manifest.endpoints?.resolve?.url, 'manifest.endpoints.resolve required');
  assert(Array.isArray(manifest.query_capabilities) && manifest.query_capabilities.length >= 1, 'at least one query_capability required');
  assert(Array.isArray(manifest.object_contracts), 'object_contracts must be an array');
});

await check('Registration center is reachable', async () => {
  const health = await get(`${registrationBaseUrl}/health`);
  assert(health.ok === true, 'registration center health.ok should be true');
});

await check('Shopify catalog registers with registration center → accepted_indexed', async () => {
  const result = await post(`/ocp/catalogs/register`, {
    ocp_version: '1.0',
    kind: 'CatalogRegistration',
    id: `catreg_${shopifyCatalogId}_${registrationVersion}`,
    registration_id: registrationId,
    catalog_id: shopifyCatalogId,
    registration_version: registrationVersion,
    updated_at: new Date().toISOString(),
    homepage: shopifyBaseUrl,
    well_known_url: `${shopifyBaseUrl}/.well-known/ocp-catalog`,
    claimed_domains: ['localhost'],
    operator: {
      operator_id: 'shopify_bridge_local_operator',
      display_name: 'Shopify Bridge (local dev)',
      contact_email: 'ops@example.test',
    },
    intended_visibility: 'public',
    tags: ['shopify', 'commerce', 'product', 'realtime'],
  });
  assert(result.status === 'accepted_indexed', `expected accepted_indexed, got ${result.status}: ${JSON.stringify(result)}`);
  assert(result.indexed === true, 'should be indexed');
});

await check('Registration center search returns the Shopify catalog', async () => {
  const result = await post(`/ocp/catalogs/search`, {
    ocp_version: '1.0',
    kind: 'CatalogSearchRequest',
    query: 'shopify',
    limit: 20,
    explain: true,
  });
  const item = result.items.find((c: any) => c.catalog_id === shopifyCatalogId);
  assert(item, `search results should include ${shopifyCatalogId}`);
  assert(item.route_hint?.query_url, 'item.route_hint.query_url must be present');
  assert(item.route_hint?.resolve_url, 'item.route_hint.resolve_url must be present');
});

await check('Registration center resolve returns route_hint by catalog_id', async () => {
  const routeHint = await post(`/ocp/catalogs/resolve`, {
    ocp_version: '1.0',
    kind: 'CatalogResolveRequest',
    catalog_id: shopifyCatalogId,
  });
  assert(routeHint.catalog_id === shopifyCatalogId, 'route_hint.catalog_id mismatch');
  assert(typeof routeHint.query_url === 'string' && routeHint.query_url.length > 0, 'query_url required');
  assert(typeof routeHint.resolve_url === 'string' && routeHint.resolve_url.length > 0, 'resolve_url required');
  routeQueryUrl = routeHint.query_url;
  routeResolveUrl = routeHint.resolve_url;
});

let firstEntryId = '';

await check('Follow route_hint.query_url → keyword search returns at least one entry', async () => {
  const result = await postAbs(routeQueryUrl, { query: 'sweater', limit: 5 });
  assert(result.kind === 'CatalogQueryResult', `expected CatalogQueryResult, got ${result.kind}`);
  assert(result.result_count >= 1, `expected ≥1 results, got ${result.result_count}`);
  firstEntryId = result.items[0].entry_id;
  assert(firstEntryId?.startsWith('entry_'), 'entry_id should have entry_ prefix');
  assert(result.policy_summary?.selected_capability_id === 'ocp.shopify.product.search.v1', 'capability mismatch');
});

await check('Follow route_hint.resolve_url → returns ResolvableReference with action_bindings', async () => {
  const result = await postAbs(routeResolveUrl, { entry_id: firstEntryId });
  assert(result.kind === 'ResolvableReference', `expected ResolvableReference, got ${result.kind}`);
  assert(result.entry_id === firstEntryId, 'entry_id should round-trip');
  assert(Array.isArray(result.action_bindings), 'action_bindings must be array');
  assert(result.action_bindings.length >= 1, `expected ≥1 actions, got ${result.action_bindings.length}`);
  for (const a of result.action_bindings) {
    assert(a.action_type === 'url', `action_type=${a.action_type}`);
    assert(a.entrypoint?.url?.startsWith('https://'), `entrypoint.url should be https://: ${a.entrypoint?.url}`);
  }
});

await check('Registration center re-discovers Shopify catalog via refresh (manifest re-fetched)', async () => {
  // Bump version → triggers a fresh fetch of the well-known doc + manifest
  const result = await post(`/ocp/catalogs/register`, {
    ocp_version: '1.0',
    kind: 'CatalogRegistration',
    id: `catreg_${shopifyCatalogId}_${registrationVersion + 1}`,
    registration_id: registrationId,
    catalog_id: shopifyCatalogId,
    registration_version: registrationVersion + 1,
    updated_at: new Date().toISOString(),
    homepage: shopifyBaseUrl,
    well_known_url: `${shopifyBaseUrl}/.well-known/ocp-catalog`,
    claimed_domains: ['localhost'],
    operator: { display_name: 'Shopify Bridge (local dev)' },
    intended_visibility: 'public',
    tags: ['shopify'],
  });
  assert(result.status === 'accepted_indexed', `re-register status=${result.status}`);
});

console.log(`\nshopify ↔ registration center E2E: ${checks.length} checks passed.`);

// ─────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────

async function check(label: string, fn: () => Promise<void>) {
  try {
    await fn();
    checks.push(label);
    console.log(`ok - ${label}`);
  } catch (err) {
    console.error(`failed - ${label}`);
    console.error(err);
    process.exit(1);
  }
}

async function get(url: string) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  return parse(res, url);
}

async function post(path: string, body: unknown) {
  return postAbs(`${registrationBaseUrl}${path}`, body);
}

async function postAbs(url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parse(res, url);
}

async function parse(res: Response, url: string) {
  const text = await res.text();
  let payload: any;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = text;
  }
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} from ${url}: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`);
  }
  return payload;
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
