/**
 * MCP -> Skill Gateway smoke test.
 *
 * 验证经由 ocp-mcp-server 调用 skill_search / skill_deeplink 的最小闭环:
 *   Step 1: MCP tools/list 含 skill_search / skill_deeplink
 *   Step 2: tools/call skill_search 返回商品结果
 *   Step 3: 从第一条结果取 catalog_id + entry_ref 再调 skill_deeplink
 *
 * 用法:
 *   MCP_SKILL_SMOKE_BASE=http://localhost:4300/mcp bun scripts/mcp-skill-smoke.ts
 */

const mcpUrl = (process.env.MCP_SKILL_SMOKE_BASE ?? 'http://localhost:4300/mcp').replace(/\/$/, '');

const checks: { label: string; ok: boolean; details: string }[] = [];
let exitCode = 0;

try {
  await runAllChecks();
} catch (err) {
  console.error('\n[mcp-skill-smoke] aborted:', err instanceof Error ? err.message : err);
  exitCode = 1;
}
printSummary();
process.exit(exitCode || (checks.some((c) => !c.ok) ? 1 : 0));

async function runAllChecks() {
  console.log(`\nMCP Skill smoke @ ${mcpUrl}\n${'─'.repeat(60)}`);

  await check('Step 1: tools/list exposes skill_search + skill_deeplink', async () => {
    const res = await mcpCall('tools/list', {});
    const tools = Array.isArray(res?.tools) ? res.tools : [];
    const names = tools.map((tool: any) => tool?.name).filter((name: unknown) => typeof name === 'string');
    assert(names.includes('skill_search'), 'skill_search exists');
    assert(names.includes('skill_deeplink'), 'skill_deeplink exists');
    return `tools=${names.length}`;
  });

  let firstHit: { catalog_id: string; entry_ref: string } | undefined;
  await check('Step 2: tools/call skill_search returns items', async () => {
    const res = await mcpCall('tools/call', {
      name: 'skill_search',
      arguments: {
        query: '耳机',
        page_size: 2,
      },
    });
    const payload = extractStructuredContent(res);
    const items = Array.isArray(payload?.items) ? payload.items : [];
    assert(items.length > 0, 'items non-empty');
    const first = items[0];
    assert(typeof first?.catalog_id === 'string' && first.catalog_id.length > 0, 'first item catalog_id');
    assert(typeof first?.entry_ref === 'string' && first.entry_ref.length > 0, 'first item entry_ref');
    firstHit = {
      catalog_id: first.catalog_id,
      entry_ref: first.entry_ref,
    };
    return `total=${payload?.total ?? items.length}, first_catalog=${first.catalog_id}`;
  });

  await check('Step 3: tools/call skill_deeplink returns deeplink_url', async () => {
    assert(firstHit, 'first skill_search hit captured');
    const res = await mcpCall('tools/call', {
      name: 'skill_deeplink',
      arguments: firstHit,
    });
    const payload = extractStructuredContent(res);
    assert(typeof payload?.catalog_id === 'string' && payload.catalog_id.length > 0, 'catalog_id echo');
    assert(typeof payload?.deeplink_url === 'string' && payload.deeplink_url.length > 0, 'deeplink_url present');
    return payload.deeplink_url;
  });
}

async function mcpCall(method: string, params: Record<string, unknown>) {
  const res = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} -> HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  const json = text ? JSON.parse(text) : {};
  if (json.error) {
    throw new Error(`${method} -> MCP error: ${JSON.stringify(json.error)}`);
  }
  return json.result;
}

function extractStructuredContent(result: any) {
  return result?.structuredContent ?? {};
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
