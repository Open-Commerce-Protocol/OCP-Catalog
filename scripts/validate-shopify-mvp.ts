// End-to-end validation for the Shopify Catalog (OCP bridge).
//
// Prereqs:
//   1. shopify-catalog-api running, default http://localhost:4320.
//      Minimal boot:
//        bun run --cwd apps/examples/shopify-catalog-api dev
//      Defaults SHOPIFY_MOCK=true; no Shopify credentials required.
//
// Exercises: discovery -> manifest -> health -> contracts ->
//            keyword query -> resolve. Verifies the OCP shape (kind,
//            entry_id round-trip, action_bindings, policy_summary).

const baseUrl = (process.env.SHOPIFY_CATALOG_PUBLIC_BASE_URL ?? 'http://localhost:4320').replace(/\/$/, '');
const catalogIdEnv = process.env.SHOPIFY_CATALOG_ID; // optional; we read it from /ocp/manifest

const checks: string[] = [];

await check('OCP discovery', async () => {
  const discovery = await get('/.well-known/ocp-catalog');
  assert(typeof discovery.catalog_id === 'string', 'catalog_id should be present');
  assert(typeof discovery.manifest_url === 'string', 'manifest_url should be present');
  if (catalogIdEnv) {
    assert(discovery.catalog_id === catalogIdEnv, `catalog_id should match env (${catalogIdEnv})`);
  }
});

await check('OCP manifest exposes only query/resolve capability', async () => {
  const manifest = await get('/ocp/manifest');
  assert(manifest.kind === 'CatalogManifest', 'manifest kind should match');
  assert(manifest.query_capabilities?.length > 0, 'query_capabilities should be present');
  assert(
    manifest.query_capabilities[0].capability_id === 'ocp.shopify.product.search.v1',
    'capability_id should be shopify.product.search.v1',
  );
  assert(!manifest.sync_capabilities, 'should NOT advertise sync (real-time bridge)');
});

await check('OCP health is ready', async () => {
  const health = await get('/ocp/health');
  assert(health.kind === 'CatalogHealth', 'kind should be CatalogHealth');
  assert(health.ready === true, 'should be ready');
  assert(health.status === 'healthy', 'status should be healthy');
});

await check('OCP contracts: empty', async () => {
  const contracts = await get('/ocp/contracts');
  assert(contracts.kind === 'ObjectContractList', 'kind should match');
  assert(contracts.object_contracts.length === 0, 'should advertise zero provider contracts');
});

let firstEntryId: string | undefined;

await check('OCP query: keyword returns at least one item', async () => {
  const result = await post('/ocp/query', { query: 'sweater', limit: 5 });
  assert(result.kind === 'CatalogQueryResult', 'kind should be CatalogQueryResult');
  assert(result.result_count >= 1, 'should return at least one item');
  assert(result.entries[0].entry.entry_id?.startsWith('entry_'), 'entry_id should have entry_ prefix');
  assert(
    result.policy_summary.selected_capability_id === 'ocp.shopify.product.search.v1',
    'policy_summary.capability should match',
  );
  firstEntryId = result.entries[0].entry.entry_id;
});

await check('OCP query: rejected_filters surface unsupported filters', async () => {
  const result = await post('/ocp/query', {
    query: 'sweater',
    filters: { brand: 'acme', min_amount: 10 },
  });
  assert(result.policy_summary.rejected_filters.includes('brand'), 'brand should be rejected');
  assert(result.policy_summary.rejected_filters.includes('min_amount'), 'min_amount should be rejected');
});

await check('OCP resolve: returns ResolvableReference with action_bindings', async () => {
  if (!firstEntryId) throw new Error('no entry_id from query');
  const result = await post('/ocp/resolve', { entry_id: firstEntryId });
  assert(result.kind === 'ResolvableReference', 'kind should be ResolvableReference');
  assert(result.entry_id === firstEntryId, 'entry_id should round-trip');
  assert(Array.isArray(result.action_bindings), 'action_bindings should be an array');
  assert(result.action_bindings.length > 0, 'expected at least one available variant');
  for (const a of result.action_bindings) {
    assert(a.action_type === 'url', 'action_type should be url');
    assert(typeof a.entrypoint?.url === 'string' && a.entrypoint.url.startsWith('https://'),
      'entrypoint.url should be https://');
  }
  assert(result.live_checks?.[0]?.status === 'passed', 'live_check should pass for in-stock product');
});

console.log(`\nshopify-catalog-api MVP validate: ${checks.length} checks passed.`);

async function check(label: string, fn: () => Promise<void>) {
  try {
    await fn();
    checks.push(label);
    console.log(`ok - ${label}`);
  } catch (err) {
    console.error(`failed - ${label}`);
    throw err;
  }
}

async function get(path: string) {
  const res = await fetch(`${baseUrl}${path}`);
  return parse(res);
}

async function post(path: string, body: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parse(res);
}

async function parse(res: Response) {
  const text = await res.text();
  let payload: any;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = text;
  }
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`);
  }
  return payload;
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
