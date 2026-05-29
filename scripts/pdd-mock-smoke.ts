/**
 * PDD Duoduojinbao mock-mode end-to-end smoke test.
 *
 * 一条命令跑完整个 Catalog Node 链路,5 个检查点对齐 alimama / JD Checkpoint D:
 *   Step 1: Discovery       — .well-known + manifest 形态校验
 *   Step 2: Query           — keyword 搜索拿到 fixture 商品列表 (价格已是元)
 *   Step 3: Resolve         — 单 entry 拿到带 p.pinduoduo.com 短链的 ActionBinding
 *   Step 4: Order sync      — /admin/sync-orders 把订单写入 ledger
 *   Step 5: Stats aggregation — /admin/stats 校验 by_status (8→3 档合并) + by_position (pid 字符串) + by_agent
 *
 * 默认行为:in-process 起一个 Catalog Node 监听 :4339 (避开 :4330 防冲突),
 * 跑完 5 步,清理,exit。
 *
 * 切到外部 server:设 PDD_SMOKE_BASE_URL=http://localhost:4330 → 不起内部 server。
 *
 * 用法:
 *   bun run smoke:pdd
 *   # 或
 *   bun scripts/pdd-mock-smoke.ts
 */
import { PddClient } from '../apps/examples/pdd-catalog-api/src/pdd/client';
import { createPddCatalogApp } from '../apps/examples/pdd-catalog-api/src/app';
import { loadPddConfig } from '../apps/examples/pdd-catalog-api/src/config';
import { CommissionLedger } from '../apps/examples/pdd-catalog-api/src/services/commission-ledger';

const SMOKE_PORT = 4339;
const SMOKE_ADMIN_KEY = 'smoke-admin-key';

const externalBase = process.env.PDD_SMOKE_BASE_URL;
const baseUrl = (externalBase ?? `http://localhost:${SMOKE_PORT}`).replace(/\/$/, '');
const adminKey = process.env.PDD_CATALOG_ADMIN_KEY ?? SMOKE_ADMIN_KEY;

// ============================================================
// 启动内部 server (除非外部指定)
// ============================================================

let server: { stop: () => void } | null = null;
if (!externalBase) {
  const cfg = loadPddConfig({
    PDD_CATALOG_PORT: String(SMOKE_PORT),
    PDD_CATALOG_PUBLIC_BASE_URL: `http://localhost:${SMOKE_PORT}`,
    PDD_CATALOG_ADMIN_KEY: SMOKE_ADMIN_KEY,
    PDD_MOCK: 'true',
    PDD_ORDER_POLL_INTERVAL_SEC: '0',
    PDD_CUSTOM_PARAMS_MODE: 'enabled',
  } as NodeJS.ProcessEnv);
  const pdd = new PddClient(cfg);
  const ledger = new CommissionLedger();
  const elysia = createPddCatalogApp({ pdd, ledger, cfg }).listen(SMOKE_PORT);
  server = { stop: () => elysia.stop() };
  await new Promise((r) => setTimeout(r, 100));
}

// ============================================================
// Checks
// ============================================================

const checks: { label: string; details: string }[] = [];

let exitCode = 0;
try {
  await runAllChecks();
  printSummary();
} catch (err) {
  console.error('\n[smoke] FAILED:', err instanceof Error ? err.message : err);
  exitCode = 1;
} finally {
  server?.stop();
}
process.exit(exitCode);

async function runAllChecks() {
  console.log(`\nPDD Duoduojinbao mock smoke @ ${baseUrl}\n${'─'.repeat(60)}`);

  // ===== Step 1: Discovery =====
  await check('Step 1: Discovery (well-known + manifest)', async () => {
    const wk = await get('/.well-known/ocp-catalog');
    assert(wk.kind === 'WellKnownCatalogDiscovery', 'well-known kind');
    assert(typeof wk.manifest_url === 'string', 'manifest_url present');

    const manifest = await get('/ocp/manifest');
    assert(manifest.kind === 'CatalogManifest', 'manifest kind');
    assert(
      manifest.endpoints.provider_registration === undefined,
      'no provider_registration endpoint (real-time Catalog Node)',
    );
    assert(
      manifest.query_capabilities[0]?.metadata?.source_id === 'pdd',
      'source_id == pdd',
    );
    assert(
      manifest.query_capabilities[0]?.filterable_field_refs?.includes(
        'affiliate.product#/pdd_merchant_type',
      ),
      'pdd_merchant_type exposed as filterable (PDD-exclusive dimension)',
    );
    return `catalog_id=${manifest.catalog_id}, capabilities=${manifest.query_capabilities.length}`;
  });

  // ===== Step 2: Query =====
  let firstEntryId = '';
  let firstTitle = '';
  let firstPriceYuan = 0;
  await check('Step 2: Query (keyword search → fixture items, price in yuan)', async () => {
    const result = await post('/ocp/query', {
      kind: 'CatalogQueryRequest',
      query: '耳机',
      limit: 5,
      filters: {},
    });
    assert(result.kind === 'CatalogQueryResult', 'result kind');
    assert(result.items.length >= 1, 'at least 1 item returned');
    assert(
      result.items[0].entry_id.startsWith('entry_pdd_'),
      'entry_id has pdd prefix',
    );
    assert(result.items[0].provider_id === 'pdd', 'provider_id == pdd');
    assert(
      result.items[0].attributes.platform === 'pdd',
      'attributes.platform == pdd',
    );
    // 价格必须已经是元 (PDD 分单位换算的关键不变量)
    const amount = result.items[0].attributes.price?.amount;
    assert(typeof amount === 'number', 'price.amount is number');
    assert(amount < 100000, `price already in yuan (got ${amount}, expected < 100000)`);
    firstEntryId = result.items[0].entry_id;
    firstTitle = result.items[0].title;
    firstPriceYuan = amount;
    return `${result.items.length} items, first=${firstTitle.slice(0, 24)}… (¥${firstPriceYuan})`;
  });

  // ===== Step 3: Resolve =====
  let resolveDetails = '';
  await check('Step 3: Resolve (mint p.pinduoduo.com short link)', async () => {
    const result = await post('/ocp/resolve', {
      kind: 'ResolveRequest',
      entry_id: firstEntryId,
      purpose: 'checkout',
    });
    assert(result.kind === 'ResolvableReference', 'resolve kind');
    assert(result.action_bindings.length > 0, 'at least 1 ActionBinding');
    const primary = result.action_bindings[0];
    assert(
      primary.entrypoint.url.includes('p.pinduoduo.com'),
      `primary URL contains p.pinduoduo.com (got ${primary.entrypoint.url})`,
    );
    assert(
      result.visible_attributes?.custom_params_mode === 'enabled',
      'custom_params_mode reported in visible_attributes',
    );
    assert(
      result.live_checks[0]?.status === 'passed',
      'live_check passed',
    );
    resolveDetails = `${result.action_bindings.length} binding(s), url=${primary.entrypoint.url}`;
  });

  // ===== Step 4: Order sync =====
  let syncDetails = '';
  await check('Step 4: Admin sync-orders (push fixture orders → ledger)', async () => {
    const result = await post('/admin/sync-orders', {}, { adminKey: true });
    assert(result.fetched >= 1, 'fetched at least 1 order');
    assert(result.inserted >= 1, 'inserted at least 1 order');
    assert(result.updated === 0, 'first sync should have 0 updated');
    syncDetails = `fetched=${result.fetched}, inserted=${result.inserted}`;

    // 再跑一次,验证幂等
    const second = await post('/admin/sync-orders', {}, { adminKey: true });
    assert(second.inserted === 0, 'second sync inserts 0 (idempotent)');
    assert(second.updated === result.fetched, 'second sync updates all');
  });

  // ===== Step 5: Stats =====
  let statsDetails = '';
  await check('Step 5: Admin stats (by_status 8→3 档合并 + by_position pid 字符串 + by_agent)', async () => {
    const stats = await get('/admin/stats', { adminKey: true });
    assert(stats.total_orders > 0, 'total_orders > 0');
    assert(stats.total_pay_amount_fen > 0, 'total GMV > 0');
    // PDD order_status 0/4/5/8 应该合并为 paid=1, settled=2, invalid=1
    assert(stats.by_status.paid >= 1, 'paid >= 1');
    assert(stats.by_status.settled >= 2, 'settled >= 2 (PDD 4+8 都映射到 settled)');
    assert(stats.by_status.invalid >= 1, 'invalid >= 1');
    // by_position 的 key 应该是 PDD pid 字符串(含下划线)
    const positionKeys = Object.keys(stats.by_position);
    assert(positionKeys.length > 0, 'by_position has entries');
    assert(
      positionKeys.some((k) => k.includes('_')),
      `by_position key is PDD pid string (e.g. "26829999_278234567"), got ${positionKeys.join(',')}`,
    );
    // by_agent 来自 custom_parameters.uid
    assert(
      Object.keys(stats.by_agent).length > 0,
      'by_agent has entries (from custom_parameters.uid)',
    );

    const gmvYuan = (stats.total_pay_amount_fen / 100).toFixed(2);
    const estCommYuan = (stats.total_estimated_commission_fen / 100).toFixed(2);
    const realCommYuan = (stats.total_real_commission_fen / 100).toFixed(2);
    const byAgentSummary = Object.entries(stats.by_agent)
      .map(([k, v]: [string, any]) => `${k}=${v.orders}`)
      .join(', ');
    statsDetails =
      `orders=${stats.total_orders}, GMV=¥${gmvYuan}, ` +
      `est_comm=¥${estCommYuan}, real_comm=¥${realCommYuan}, ` +
      `by_agent={${byAgentSummary}}`;
  });

  // 注入详情
  for (const c of checks) {
    if (c.label.startsWith('Step 3') && resolveDetails) c.details = resolveDetails;
    if (c.label.startsWith('Step 4') && syncDetails) c.details = syncDetails;
    if (c.label.startsWith('Step 5') && statsDetails) c.details = statsDetails;
  }
}

function printSummary() {
  console.log('\n' + '─'.repeat(60));
  console.log(`✅ PDD Duoduojinbao mock smoke passed — ${checks.length}/5 checkpoints\n`);
  for (const c of checks) {
    console.log(`  ✓ ${c.label}`);
    if (c.details) console.log(`      ${c.details}`);
  }
  console.log('');
  console.log('Ready: 切到真实只需要把环境变量改成 PDD_MOCK=false');
  console.log('       + PDD_CLIENT_ID/CLIENT_SECRET/PID 填上即可。');
  console.log('');
}

// ============================================================
// helpers
// ============================================================

async function check(label: string, fn: () => Promise<string | void>) {
  try {
    const details = (await fn()) ?? '';
    checks.push({ label, details: typeof details === 'string' ? details : '' });
    process.stdout.write(`ok   ${label}\n`);
    if (details && typeof details === 'string') {
      process.stdout.write(`     ${details}\n`);
    }
  } catch (err) {
    process.stdout.write(`FAIL ${label}\n`);
    throw err;
  }
}

async function get(path: string, opts: { adminKey?: boolean } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: opts.adminKey ? { 'x-admin-key': adminKey } : {},
  });
  return parse(res, path);
}

async function post(
  path: string,
  body: unknown,
  opts: { adminKey?: boolean } = {},
) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(opts.adminKey ? { 'x-admin-key': adminKey } : {}),
    },
    body: JSON.stringify(body),
  });
  return parse(res, path);
}

async function parse(res: Response, path: string) {
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${path} HTTP ${res.status}: ${text}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${path} response not JSON: ${text.slice(0, 200)}`);
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}
