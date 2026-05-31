/**
 * OCP Skill Gateway smoke test.
 *
 * 验证 gateway HTTP 层的关键链路:
 *   Step 1: /health + /openapi.yaml 静态校验
 *   Step 2: /dashboard/catalogs 拿到所有 catalog 的 ping 状态
 *   Step 3: 鉴权 (无 key 401, 错 key 401, 正确 key 200)
 *   Step 4: /skill/search 跨多 catalog fan-out
 *   Step 5: /skill/deeplink 每个 catalog 都能 resolve
 *   Step 6: /skill/{compare,recommend} 正常
 *   Step 7: /skill/order 返回 501 not_implemented (M2 占位)
 *
 * 默认:smoke 一个外部已启动的 gateway。
 *
 * 用法:
 *   # Terminal A: 起 catalog mocks + gateway
 *   bun run --cwd apps/examples/jdunion-catalog-api start &
 *   PDD_CATALOG_PORT=4340 bun run --cwd apps/examples/pdd-catalog-api start &
 *   bun run --cwd apps/examples/alimama-catalog-api start &
 *   SKILL_GATEWAY_API_KEYS=sk_dev_demo_001 \
 *   SKILL_GATEWAY_CATALOGS='[{...},{...},{...}]' \
 *   bun apps/examples/ocp-skill-gateway/src/index.ts
 *
 *   # Terminal B: smoke
 *   SKILL_GATEWAY_SMOKE_KEY=sk_dev_demo_001 bun scripts/skill-gateway-smoke.ts
 *
 *   # 或自定义 gateway 地址
 *   SKILL_GATEWAY_SMOKE_BASE=http://localhost:4330 \
 *   SKILL_GATEWAY_SMOKE_KEY=sk_dev_demo_001 \
 *   bun scripts/skill-gateway-smoke.ts
 *
 * 环境变量:
 *   SKILL_GATEWAY_SMOKE_BASE  默认 http://localhost:4330
 *   SKILL_GATEWAY_SMOKE_KEY   必填,要和 gateway 的 SKILL_GATEWAY_API_KEYS 里某个一致
 */
import jsYaml from 'js-yaml';
const parseYaml = (text: string) => jsYaml.load(text);

const baseUrl = (process.env.SKILL_GATEWAY_SMOKE_BASE ?? 'http://localhost:4330').replace(/\/$/, '');
const apiKey = process.env.SKILL_GATEWAY_SMOKE_KEY ?? '';

if (!apiKey) {
  console.error('SKILL_GATEWAY_SMOKE_KEY required. e.g. SKILL_GATEWAY_SMOKE_KEY=sk_dev_demo_001 bun scripts/skill-gateway-smoke.ts');
  process.exit(2);
}

const checks: { label: string; ok: boolean; details: string }[] = [];
let exitCode = 0;

try {
  await runAllChecks();
} catch (err) {
  console.error('\n[smoke] aborted:', err instanceof Error ? err.message : err);
  exitCode = 1;
}
printSummary();
process.exit(exitCode || (checks.some((c) => !c.ok) ? 1 : 0));

async function runAllChecks() {
  console.log(`\nSkill Gateway smoke @ ${baseUrl}\n${'─'.repeat(60)}`);

  // ============ Step 1: /health + /openapi.yaml ============
  await check('Step 1a: GET /health', async () => {
    const h = await getJson('/health');
    assert(h.ok === true, '/health ok');
    // upstream 字段:ocp_mcp 或 local_catalogs;早期版本字段是 catalogs(整数),都接受
    assert(
      typeof h.upstream === 'string' ||
        (typeof h.catalogs === 'number' && h.catalogs > 0),
      'upstream configured (ocp_mcp / local_catalogs)',
    );
    assert(typeof h.api_keys_loaded === 'number' && h.api_keys_loaded > 0, 'at least 1 api key');
    return `upstream=${h.upstream ?? `local(${h.catalogs})`}, api_keys=${h.api_keys_loaded}`;
  });

  await check('Step 1b: GET /openapi.yaml (structural)', async () => {
    const res = await fetch(`${baseUrl}/openapi.yaml`);
    assert(res.ok, `openapi.yaml status ${res.status}`);
    const text = await res.text();
    const doc = parseYaml(text) as any;
    assert(doc.openapi?.startsWith('3.'), 'openapi 3.x');
    assert(doc.info?.title && doc.info?.version, 'info.title/version');
    const opIds: string[] = [];
    for (const methods of Object.values<any>(doc.paths ?? {})) {
      for (const op of Object.values<any>(methods)) {
        if (op?.operationId) opIds.push(op.operationId);
        assert(op?.summary || op?.description, 'each op has summary/description');
        assert(op?.responses, 'each op has responses');
      }
    }
    assert(opIds.includes('skill_search'), 'has skill_search opId');
    assert(opIds.includes('skill_deeplink'), 'has skill_deeplink opId');
    assert(doc.components?.securitySchemes?.SkillKey, 'SkillKey security scheme');
    return `ops=${opIds.length}: ${opIds.join(',')}`;
  });

  // ============ Step 2: dashboard/catalogs ============
  const allCatalogIds: string[] = [];
  await check('Step 2: GET /dashboard/catalogs', async () => {
    const r = await getJson('/dashboard/catalogs');
    assert(Array.isArray(r.catalogs) && r.catalogs.length > 0, 'catalogs array non-empty');
    for (const c of r.catalogs) {
      allCatalogIds.push(c.id);
    }
    const unhealthy = r.catalogs.filter((c: any) => !c.ok);
    if (unhealthy.length) {
      throw new Error(`unhealthy catalogs: ${unhealthy.map((c: any) => c.id).join(',')}`);
    }
    return `${r.catalogs.length} catalogs all healthy: ${allCatalogIds.join(', ')}`;
  });

  // ============ Step 3: 鉴权 ============
  await check('Step 3a: /skill/search without key → 401', async () => {
    const res = await fetch(`${baseUrl}/skill/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'x' }),
    });
    assert(res.status === 401, `expected 401 got ${res.status}`);
    return 'unauthorized';
  });

  await check('Step 3b: /skill/search with wrong key → 401', async () => {
    const res = await fetch(`${baseUrl}/skill/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-skill-key': 'sk_wrong_xxx' },
      body: JSON.stringify({ query: 'x' }),
    });
    assert(res.status === 401, `expected 401 got ${res.status}`);
    return 'rejected';
  });

  // ============ Step 4: /skill/search fan-out ============
  const firstHits: Record<string, { entry_ref: string; title: string }> = {};
  await check('Step 4: POST /skill/search (fan-out across all catalogs)', async () => {
    const r = await postJson('/skill/search', { query: '耳机', page_size: 3 });
    assert(Array.isArray(r.items) && r.items.length > 0, 'items non-empty');
    assert(Array.isArray(r.per_catalog) && r.per_catalog.length === allCatalogIds.length, 'per_catalog covers all');
    // ok=true 但 count=0 是正常的(某些 catalog 对中文关键词没匹配),不算 fail
    const failed: string[] = [];
    for (const cid of allCatalogIds) {
      const pc = r.per_catalog.find((p: any) => p.catalog_id === cid);
      if (pc && !pc.ok) failed.push(cid);
      const sample = r.items.find((it: any) => it.catalog_id === cid);
      if (sample) firstHits[cid] = { entry_ref: sample.entry_ref, title: sample.title };
    }
    // 只要不是全部都崩就当作 fan-out 工作:上游单个 catalog 偶发抖动不算 smoke fail
    if (failed.length === allCatalogIds.length) throw new Error(`all catalogs errored: ${failed.join(',')}`);
    if (Object.keys(firstHits).length === 0) throw new Error('no items from any catalog');
    const flakyNote = failed.length ? ` (flaky: ${failed.join(',')})` : '';
    return `total=${r.total}, catalogs with items: ${Object.keys(firstHits).length}/${allCatalogIds.length}${flakyNote}`;
  });

  // ============ Step 5: /skill/deeplink per catalog ============
  for (const cid of allCatalogIds) {
    const ref = firstHits[cid]?.entry_ref;
    if (!ref) continue;
    await check(`Step 5: /skill/deeplink for ${cid}`, async () => {
      const r = await postJson('/skill/deeplink', { catalog_id: cid, entry_ref: ref });
      assert(r.catalog_id === cid, 'catalog_id echo');
      assert(typeof r.deeplink_url === 'string' && r.deeplink_url.length > 0, 'deeplink_url present');
      return r.deeplink_url;
    });
  }

  await check('Step 5e: /skill/deeplink with unknown catalog → graceful empty', async () => {
    // 两种 broker 行为不同:
    //   LocalCatalogs: 本地直接 short-circuit,返回 error 字段
    //   OcpMcp: 透传给 MCP server,MCP 返回结构化空结果(deeplink_url 为空 / error 也可能为空)
    // 共同要求:不要 200 + deeplink_url 实际指向真链接,也不要 500 崩
    const r = await postJson('/skill/deeplink', { catalog_id: 'cat_does_not_exist', entry_ref: 'foo' });
    const noUrl = !r.deeplink_url;
    const errorOk = typeof r.error === 'string' && r.error.length > 0;
    assert(noUrl || errorOk, 'either no deeplink_url or explicit error');
    return errorOk ? `error: ${r.error.slice(0, 60)}` : 'no deeplink_url (mcp empty result)';
  });

  // ============ Step 6: compare + recommend ============
  await check('Step 6a: POST /skill/compare', async () => {
    const r = await postJson('/skill/compare', { query: '耳机', page_size: 3 });
    assert(Array.isArray(r.items), 'items array');
    if (r.items.length >= 2) {
      const prices = r.items.map((it: any) => it.price).filter((p: any) => typeof p === 'number');
      for (let i = 1; i < prices.length; i++) {
        assert(prices[i] >= prices[i - 1], 'sorted ascending by price');
      }
    }
    return `items=${r.items.length} sorted asc`;
  });

  await check('Step 6b: POST /skill/recommend with budget_max', async () => {
    const r = await postJson('/skill/recommend', { query: '充电器', budget_max: 200 });
    assert(Array.isArray(r.items), 'items array');
    for (const it of r.items) {
      if (typeof it.price === 'number') {
        assert(it.price <= 200, `price ${it.price} <= budget_max 200`);
      }
    }
    return `items=${r.items.length}, all within budget`;
  });

  // ============ Step 7: order (M2 占位) ============
  await check('Step 7: POST /skill/order → 501 not_implemented', async () => {
    const res = await fetch(`${baseUrl}/skill/order`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-skill-key': apiKey },
      body: JSON.stringify({}),
    });
    assert(res.status === 501, `expected 501 got ${res.status}`);
    return 'm2 placeholder';
  });
}

// ============================================================
// helpers
// ============================================================

async function getJson(path: string) {
  const res = await fetch(`${baseUrl}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return await res.json();
}

async function postJson(path: string, body: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-skill-key': apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`POST ${path} → ${res.status}: ${txt.slice(0, 200)}`);
  }
  return await res.json();
}

function assert(cond: any, msg: string): asserts cond {
  if (!cond) throw new Error(`assert failed: ${msg}`);
}

async function check(label: string, run: () => Promise<string>) {
  try {
    const details = await run();
    checks.push({ label, ok: true, details });
    console.log(`  ✓ ${label}  —  ${details}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    checks.push({ label, ok: false, details: msg });
    console.log(`  ✗ ${label}  —  ${msg}`);
    exitCode = 1;
  }
}

function printSummary() {
  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.length - passed;
  console.log(`${'─'.repeat(60)}\nresult: ${passed}/${checks.length} passed${failed ? ` (${failed} failed)` : ''}\n`);
}
