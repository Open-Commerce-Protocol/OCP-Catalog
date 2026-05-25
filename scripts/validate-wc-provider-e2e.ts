// End-to-end validation: woocommerce-provider-app pushes fixture products
// to a running OCP Catalog. Run alongside commerce-catalog-api on 4000.

const providerBaseUrl = (process.env.WC_PROVIDER_PUBLIC_BASE_URL ?? 'http://localhost:4410').replace(/\/$/, '');
const catalogBaseUrl = (process.env.WC_PROVIDER_CATALOG_BASE_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const adminKey = process.env.WC_PROVIDER_ADMIN_KEY ?? 'dev-wc-provider-admin-key';
const providerId = process.env.WC_PROVIDER_ID ?? 'wc_provider_local_dev';

const checks: string[] = [];

await check('Provider app is reachable', async () => {
  const h = await get(`${providerBaseUrl}/health`);
  assert(h.ok === true, 'health.ok');
  assert(h.service === 'woocommerce-provider-app', `service=${h.service}`);
});
await check('OCP catalog is reachable', async () => {
  const h = await get(`${catalogBaseUrl}/health`);
  assert(h.ok === true, 'catalog health.ok');
});
await check('Provider /admin/register → catalog accepts', async () => {
  const r = await postAdmin('/admin/register', {});
  assert(r.result?.status?.startsWith('accepted'), `status=${r.result?.status}`);
});
await check('Provider /admin/sync/full pushes fixture products', async () => {
  const r = await postAdmin('/admin/sync/full', {});
  assert(r.status === 'succeeded' || r.status === 'partial', `status=${r.status}`);
  assert(r.objects_synced >= 2, `objects_synced=${r.objects_synced}`);
});
await check('Catalog /ocp/query finds the synced WC product (waits for async index)', async () => {
  for (let attempt = 0; attempt < 20; attempt++) {
    const r = await post(`${catalogBaseUrl}/ocp/query`, { query: 'cotton apron', limit: 10 });
    if (r.kind === 'CatalogQueryResult') {
      const mine = (r.items ?? []).filter((i: any) => i.provider_id === providerId);
      if (mine.length >= 1) return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`expected ≥1 result for provider ${providerId} after 40s, got 0`);
});
await check('Catalog provider state reflects active registration', async () => {
  const state = await get(`${catalogBaseUrl}/ocp/providers/${providerId}`);
  assert(state.provider_id === providerId);
  assert(state.active_registration_version >= 1);
});
await check('Webhook ingest path: product.updated → single sync', async () => {
  const payload = { id: 901, name: 'Cotton Apron — Olive' };
  const res = await postRaw(`${providerBaseUrl}/webhooks/woocommerce`, payload, {
    'x-wc-webhook-topic': 'product.updated',
    'x-wc-webhook-source': 'https://wc-demo.example.test',
  });
  assert(res.ok === true, `webhook fail: ${JSON.stringify(res)}`);
  assert(res.topic === 'product.updated', `topic=${res.topic}`);
});

console.log(`\nwoocommerce-provider-app ↔ catalog E2E: ${checks.length} checks passed.`);

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
async function postAdmin(path: string, body: unknown) {
  const r = await fetch(`${providerBaseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-key': adminKey },
    body: JSON.stringify(body),
  });
  return parse(r, path);
}
async function postRaw(url: string, body: unknown, headers: Record<string, string>) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return parse(r, url);
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
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
