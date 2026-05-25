// End-to-end validation: shopify-provider-app pushes fixture products to a
// running OCP Catalog (commerce-catalog-api by default), and the catalog
// can search/resolve them like any other provider's objects.
//
// Prereqs (in separate terminals):
//   bun run --cwd packages/db migrate
//   bun run commerce:catalog:api       # http://localhost:4000
//   bun run shopify:provider:app       # http://localhost:4400 (mock mode default)

const providerBaseUrl = (process.env.SHOPIFY_PROVIDER_PUBLIC_BASE_URL ?? 'http://localhost:4400').replace(/\/$/, '');
const catalogBaseUrl = (process.env.SHOPIFY_PROVIDER_CATALOG_BASE_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const adminKey = process.env.SHOPIFY_PROVIDER_ADMIN_KEY ?? 'dev-shopify-provider-admin-key';
const providerId = process.env.SHOPIFY_PROVIDER_ID ?? 'shopify_provider_local_dev';

const checks: string[] = [];

await check('Provider app is reachable', async () => {
  const health = await get(`${providerBaseUrl}/health`);
  assert(health.ok === true, 'provider health.ok should be true');
  assert(health.service === 'shopify-provider-app', `service=${health.service}`);
});

await check('OCP catalog is reachable', async () => {
  const health = await get(`${catalogBaseUrl}/health`);
  assert(health.ok === true, 'catalog health.ok should be true');
});

await check('Provider /admin/register → catalog accepts', async () => {
  const result = await postAdmin(`/admin/register`, {});
  assert(result.result?.status?.startsWith('accepted'), `expected accepted_*, got ${result.result?.status}`);
});

await check('Provider /admin/sync/full pushes fixture products', async () => {
  const result = await postAdmin(`/admin/sync/full`, {});
  assert(result.status === 'succeeded' || result.status === 'partial', `unexpected status: ${result.status}`);
  assert(result.objects_synced >= 2, `expected ≥2 products synced, got ${result.objects_synced}`);
});

let firstObjectId: string | undefined;
await check('Catalog /ocp/query finds the synced Shopify product (waits for async index)', async () => {
  // commerce-catalog-api builds its search index asynchronously (~30s worker).
  // Retry up to 40s before giving up.
  let mine: any[] = [];
  for (let attempt = 0; attempt < 20; attempt++) {
    const result = await post(`${catalogBaseUrl}/ocp/query`, { query: 'wool crewneck', limit: 10 });
    if (result.kind === 'CatalogQueryResult') {
      mine = (result.entries ?? []).filter((match: any) => match.entry.provider_id === providerId);
      if (mine.length >= 1) {
        firstObjectId = mine[0].entry.object_id;
        return;
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`expected ≥1 result for provider ${providerId} after 40s, got 0`);
});

await check('Catalog provider state reflects active registration', async () => {
  const state = await get(`${catalogBaseUrl}/ocp/providers/${providerId}`);
  assert(state.provider_id === providerId, 'provider_id should match');
  assert(state.active_registration_version >= 1, 'should have at least version 1');
});

await check('Webhook ingest path: products/update → single sync', async () => {
  const payload = { id: 8001002, title: 'Linen Field Shirt' };
  const headers = { 'x-shopify-topic': 'products/update', 'x-shopify-shop-domain': 'local-dev-merchant.myshopify.com' };
  const res = await postRaw(`${providerBaseUrl}/webhooks/shopify`, payload, headers);
  assert(res.ok === true, `webhook should succeed, got ${JSON.stringify(res)}`);
  assert(res.topic === 'products/update', `expected topic products/update, got ${res.topic}`);
});

console.log(`\nshopify-provider-app ↔ catalog E2E: ${checks.length} checks passed.`);

async function check(label: string, fn: () => Promise<void>) {
  try { await fn(); checks.push(label); console.log(`ok - ${label}`); }
  catch (err) { console.error(`failed - ${label}`); console.error(err); process.exit(1); }
}
async function get(url: string) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  return parse(res, url);
}
async function post(url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parse(res, url);
}
async function postAdmin(path: string, body: unknown) {
  const res = await fetch(`${providerBaseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-key': adminKey },
    body: JSON.stringify(body),
  });
  return parse(res, path);
}
async function postRaw(url: string, body: unknown, headers: Record<string, string>) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return parse(res, url);
}
async function parse(res: Response, url: string) {
  const text = await res.text();
  let payload: any = text;
  try { payload = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} from ${url}: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`);
  }
  return payload;
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
