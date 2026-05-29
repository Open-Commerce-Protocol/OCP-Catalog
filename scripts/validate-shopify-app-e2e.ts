// E2E for the Shopify Public App (multi-tenant). Exercises the post-OAuth
// path without a browser by seeding an installation directly, then registering
// + syncing that shop into the OCP catalog and asserting the products are
// searchable. Finally simulates app/uninstalled and checks the token is purged.
//
// Modes:
//   - default (mock): SHOPIFY_APP_MOCK=true → fixture products, no Shopify.
//   - real: set SHOPIFY_APP_MOCK=false and pass a real shop+token via env:
//       E2E_SHOP_DOMAIN=foo.myshopify.com E2E_ACCESS_TOKEN=shpat_xxx
//
// Prereqs:
//   bun run commerce:catalog:api     # http://localhost:4000
//   bun run shopify:app              # http://localhost:4420

const appBase = (process.env.SHOPIFY_APP_URL ?? 'http://localhost:4420').replace(/\/$/, '');
const catalogBase = (process.env.SHOPIFY_APP_CATALOG_BASE_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const adminKey = process.env.SHOPIFY_APP_ADMIN_KEY ?? 'dev-shopify-app-admin-key';
const shop = process.env.E2E_SHOP_DOMAIN ?? 'demo-embedded.myshopify.com';
const token = process.env.E2E_ACCESS_TOKEN ?? 'mock-token';
const expectKeyword = process.env.E2E_QUERY ?? 'coffee';

const checks: string[] = [];

await check('App + catalog reachable', async () => {
  const h1 = await get(`${appBase}/health`);
  assert(h1.ok && h1.service === 'shopify-app', `app health: ${JSON.stringify(h1)}`);
  const h2 = await get(`${catalogBase}/health`);
  assert(h2.ok === true, 'catalog health');
});

await check('Seed installation (simulates post-OAuth token persist)', async () => {
  const r = await admin('POST', '/admin/installations/seed', { shop_domain: shop, access_token: token });
  assert(r.ok === true, `seed failed: ${JSON.stringify(r)}`);
  assert(r.provider_id?.startsWith('shopify_app_'), `provider_id: ${r.provider_id}`);
});

let providerId = '';
await check('Register shop as OCP provider', async () => {
  const r = await admin('POST', `/admin/register/${encodeURIComponent(shop)}`);
  assert(r.ok === true && r.registration_version >= 1, `register: ${JSON.stringify(r)}`);
  const s = await admin('GET', `/admin/status/${encodeURIComponent(shop)}`);
  providerId = s.provider_id;
});

await check('Full sync pushes products to catalog', async () => {
  const r = await admin('POST', `/admin/sync/full/${encodeURIComponent(shop)}`);
  assert(r.status === 'succeeded' || r.status === 'partial', `sync status: ${JSON.stringify(r)}`);
  assert(r.accepted_count >= 1, `expected ≥1 accepted, got ${r.accepted_count}`);
});

await check('Catalog provider state is active', async () => {
  const st = await get(`${catalogBase}/ocp/providers/${encodeURIComponent(providerId)}`);
  assert(st.provider_id === providerId, 'provider id matches');
  assert(st.active_registration_version >= 1, 'has registration version');
});

await check('Products searchable via /ocp/query (waits for async index)', async () => {
  for (let i = 0; i < 30; i++) {
    const r = await post(`${catalogBase}/ocp/query`, { query: expectKeyword, limit: 20 });
    if (r.kind === 'CatalogQueryResult') {
      const mine = (r.entries ?? r.items ?? []).filter((it: any) => (it.entry?.provider_id ?? it.provider_id) === providerId);
      if (mine.length >= 1) return;
    }
    await new Promise((res) => setTimeout(res, 2000));
  }
  throw new Error(`no products for ${providerId} after 60s`);
});

await check('Delta sync after full returns no new objects (cursor honored)', async () => {
  const r = await admin('POST', `/admin/sync/delta/${encodeURIComponent(shop)}`);
  assert(r.status === 'succeeded', `delta status: ${JSON.stringify(r)}`);
  // mock fixtures all have updatedAt before "now" cursor → 0 expected.
  assert(r.accepted_count === 0, `expected 0 delta objects, got ${r.accepted_count}`);
});

await check('app/uninstalled webhook purges the token', async () => {
  // mock mode skips HMAC, so we can post directly with the shop header.
  const res = await fetch(`${appBase}/webhooks/app/uninstalled`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-shopify-topic': 'app/uninstalled', 'x-shopify-shop-domain': shop },
    body: JSON.stringify({ shop_domain: shop }),
  });
  const body = await res.json();
  assert(body.ok === true && body.action === 'installation_token_purged', `uninstall: ${JSON.stringify(body)}`);
  // status endpoint should now show uninstalled
  const s = await admin('GET', `/admin/status/${encodeURIComponent(shop)}`);
  assert(s.status === 'uninstalled', `expected uninstalled, got ${s.status}`);
});

console.log(`\nshopify-app E2E: ${checks.length} checks passed.`);

async function check(label: string, fn: () => Promise<void>) {
  try { await fn(); checks.push(label); console.log(`ok - ${label}`); }
  catch (e) { console.error(`failed - ${label}`); console.error(e); process.exit(1); }
}
async function get(url: string) {
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  return parse(r, url);
}
async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return parse(r, url);
}
async function admin(method: 'GET' | 'POST', path: string, body?: unknown) {
  const r = await fetch(`${appBase}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-admin-key': adminKey },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return parse(r, path);
}
async function parse(res: Response, url: string) {
  const text = await res.text();
  let payload: any = text;
  try { payload = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${url}: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`);
  return payload;
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
