/**
 * JD Union mock-mode end-to-end smoke test.
 *
 * 一条命令跑完整个 Catalog Node 链路,5 个检查点对齐 alimama Checkpoint D:
 *   Step 1: Discovery       — .well-known + manifest 形态校验
 *   Step 2: Query           — keyword 搜索拿到 fixture 商品列表
 *   Step 3: Resolve         — 单 entry 拿到带 u.jd.com 短链的 ActionBinding
 *   Step 4: Order sync      — /admin/sync-orders 把订单写入 ledger
 *   Step 5: Stats aggregation — /admin/stats 校验 by_status/by_position/by_agent
 *
 * 默认行为:在 in-process 起一个 Catalog Node 监听 :4329 (避开 :4320 防冲突),
 * 跑完 5 步,清理,exit。
 *
 * 切到外部 server:设 JDUNION_SMOKE_BASE_URL=http://localhost:4320 → 不起内部 server。
 *
 * 用法:
 *   bun run smoke:jdunion
 *   # 或
 *   bun scripts/jdunion-mock-smoke.ts
 */
import { JdUnionClient } from '../apps/examples/jdunion-catalog-api/src/jd/client';
import { createJdUnionCatalogApp } from '../apps/examples/jdunion-catalog-api/src/app';
import { loadJdUnionConfig } from '../apps/examples/jdunion-catalog-api/src/config';
import { CommissionLedger } from '../apps/examples/jdunion-catalog-api/src/services/commission-ledger';

const SMOKE_PORT = 4329;
const SMOKE_ADMIN_KEY = 'smoke-admin-key';

const externalBase = process.env.JDUNION_SMOKE_BASE_URL;
const baseUrl = (externalBase ?? `http://localhost:${SMOKE_PORT}`).replace(/\/$/, '');
// 内部 server 模式下永远用 SMOKE_ADMIN_KEY (与 line ~42 启动的 server 配对);
// 仅在 externalBase 模式才读 env (那时是连外部 server,要用它的 key)
const adminKey = externalBase
  ? (process.env.JDUNION_CATALOG_ADMIN_KEY ?? SMOKE_ADMIN_KEY)
  : SMOKE_ADMIN_KEY;

// ============================================================
// 启动内部 server (除非外部指定)
// ============================================================

let server: { stop: () => void } | null = null;
if (!externalBase) {
  const cfg = loadJdUnionConfig({
    JDUNION_CATALOG_PORT: String(SMOKE_PORT),
    JDUNION_CATALOG_PUBLIC_BASE_URL: `http://localhost:${SMOKE_PORT}`,
    JDUNION_CATALOG_ADMIN_KEY: SMOKE_ADMIN_KEY,
    JDUNION_MOCK: 'true',
    JDUNION_ORDER_POLL_INTERVAL_SEC: '0',
  } as NodeJS.ProcessEnv);
  const jd = new JdUnionClient(cfg);
  const ledger = new CommissionLedger();
  const elysia = createJdUnionCatalogApp({ jd, ledger, cfg }).listen(SMOKE_PORT);
  server = { stop: () => elysia.stop() };
  // 给 Elysia 一刹那 bind
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
  console.log(`\nJD Union mock smoke @ ${baseUrl}\n${'─'.repeat(60)}`);

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
      manifest.query_capabilities[0]?.metadata?.source_id === 'jdunion',
      'source_id == jdunion',
    );
    return `catalog_id=${manifest.catalog_id}, capabilities=${manifest.query_capabilities.length}`;
  });

  // ===== Step 2: Query =====
  let firstEntryId = '';
  let firstTitle = '';
  await check('Step 2: Query (keyword search → fixture items)', async () => {
    const result = await post('/ocp/query', {
      kind: 'CatalogQueryRequest',
      query: '耳机',
      limit: 5,
      filters: {},
    });
    assert(result.kind === 'CatalogQueryResult', 'result kind');
    assert(result.items.length >= 1, 'at least 1 item returned');
    assert(
      result.items[0].entry_id.startsWith('entry_jdunion_'),
      'entry_id has jdunion prefix',
    );
    assert(result.items[0].provider_id === 'jdunion', 'provider_id == jdunion');
    assert(
      result.items[0].attributes.platform === 'jd',
      'attributes.platform == jd',
    );
    firstEntryId = result.items[0].entry_id;
    firstTitle = result.items[0].title;
    return `${result.items.length} items, first=${firstTitle.slice(0, 24)}…`;
  });

  // ===== Step 3: Resolve =====
  let resolveDetails = '';
  await check('Step 3: Resolve (mint u.jd.com short link)', async () => {
    const result = await post('/ocp/resolve', {
      kind: 'ResolveRequest',
      entry_id: firstEntryId,
      purpose: 'checkout',
    });
    assert(result.kind === 'ResolvableReference', 'resolve kind');
    assert(result.action_bindings.length > 0, 'at least 1 ActionBinding');
    const primary = result.action_bindings[0];
    assert(
      primary.entrypoint.url.includes('u.jd.com'),
      `primary URL contains u.jd.com (got ${primary.entrypoint.url})`,
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
  await check('Step 5: Admin stats (by_status / by_position / by_agent)', async () => {
    const stats = await get('/admin/stats', { adminKey: true });
    assert(stats.total_orders > 0, 'total_orders > 0');
    assert(stats.total_pay_amount_fen > 0, 'total GMV > 0');
    assert(
      Object.keys(stats.by_position).length > 0,
      'by_position has entries',
    );
    assert(
      Object.keys(stats.by_agent).length > 0,
      'by_agent has entries (JD-specific aggregation)',
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

  // 注入详情(check 已经做完了)
  for (const c of checks) {
    if (c.label.startsWith('Step 3') && resolveDetails) c.details = resolveDetails;
    if (c.label.startsWith('Step 4') && syncDetails) c.details = syncDetails;
    if (c.label.startsWith('Step 5') && statsDetails) c.details = statsDetails;
  }
}

function printSummary() {
  console.log('\n' + '─'.repeat(60));
  console.log(`✅ JD Union mock smoke passed — ${checks.length}/5 checkpoints\n`);
  for (const c of checks) {
    console.log(`  ✓ ${c.label}`);
    if (c.details) console.log(`      ${c.details}`);
  }
  console.log('');
  console.log('Ready: 切到真实只需要把环境变量改成 JDUNION_MOCK=false');
  console.log('       + JDUNION_APP_KEY/SECRET/UNION_ID/POSITION_ID 填上即可。');
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
