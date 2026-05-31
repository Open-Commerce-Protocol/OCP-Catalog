/**
 * JD Union 真实接口探针 v3 — 走 selling.* 工具商专用 API。
 *
 * 从权限页发现:
 *   promotion.common.get   → 工具商应改用 selling.promotion.get
 *   promotiongoodsinfo.query → 工具商应改用 selling.goods.query
 *   order.row.query        → 工具商应改用 selling.order.row.query
 *
 * 这个脚本绕过 client.ts 已有的方法,直接用 callJd 内核打 selling.* 三件套,
 * 验证响应形态,然后再把改动落到 client.ts 里。
 */
process.env.JDUNION_MOCK = 'false';

const { loadJdUnionConfig } = await import(
  '../apps/examples/jdunion-catalog-api/src/config'
);
const { jdSign } = await import(
  '../apps/examples/jdunion-catalog-api/src/jd/sign'
);

const cfg = loadJdUnionConfig();
const TEST_SKU = process.env.JDUNION_TEST_SKU_ID ?? '100248969231';

console.log('\nJD Union real ping v3 — selling.* 工具商三件套');
console.log('─'.repeat(64));
console.log(`Gateway:    ${cfg.JDUNION_BASE_URL}`);
console.log(`UnionID:    ${cfg.JDUNION_UNION_ID}`);
console.log(`MediaID:    ${cfg.JDUNION_MEDIA_ID ?? '(未配置)'}`);
console.log(`PositionID: ${cfg.JDUNION_POSITION_ID}`);
console.log(`Test SKU:   ${TEST_SKU}`);
console.log('─'.repeat(64));

function buildPid(positionId?: string): string {
  const pos = positionId ?? cfg.JDUNION_POSITION_ID;
  return cfg.JDUNION_MEDIA_ID
    ? `${cfg.JDUNION_UNION_ID}_${cfg.JDUNION_MEDIA_ID}_${pos}`
    : `${cfg.JDUNION_UNION_ID}_${pos}`;
}

function formatBeijingTimestamp(d: Date): string {
  const beijingMs = d.getTime() + 8 * 60 * 60 * 1000;
  return new Date(beijingMs).toISOString().replace('T', ' ').slice(0, 19);
}

async function callJd(method: string, bizParams: Record<string, unknown>) {
  const paramJson = JSON.stringify(bizParams);
  const sysParams: Record<string, string> = {
    method,
    app_key: cfg.JDUNION_APP_KEY!,
    format: 'json',
    v: '1.0',
    sign_method: 'md5',
    timestamp: formatBeijingTimestamp(new Date()),
    '360buy_param_json': paramJson,
  };
  const signed = {
    ...sysParams,
    sign: jdSign(sysParams, cfg.JDUNION_APP_SECRET!, 'md5'),
  };
  const res = await fetch(cfg.JDUNION_BASE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(signed).toString(),
  });
  return await res.json();
}

function dump(label: string, raw: any) {
  const wrapperKey = Object.keys(raw).find((k) => k !== 'requestId');
  console.log(`  wrapperKey: ${wrapperKey}`);
  const envelope = raw[wrapperKey!];
  console.log(`  outer code: ${envelope?.code}`);
  // 把 envelope 的所有字段列出来,找内层 JSON 字段名
  for (const [k, v] of Object.entries(envelope ?? {})) {
    if (k === 'code') continue;
    const summary = typeof v === 'string' ? v.slice(0, 200) : JSON.stringify(v).slice(0, 200);
    console.log(`  field ${k}: ${summary}`);
  }
  if (raw.error_response) {
    console.log(`  error_response: ${JSON.stringify(raw.error_response)}`);
  }
}

// ===== Test 1: selling.goods.query =====
console.log('\n[Test 1/3] jd.union.open.selling.goods.query (工具商版商品查询)');
try {
  const raw = await callJd('jd.union.open.selling.goods.query', {
    skuIds: TEST_SKU,
    pid: buildPid(),
  });
  dump('selling.goods.query', raw);
} catch (e) {
  console.log(`  ❌ ${e instanceof Error ? e.message : e}`);
}

// ===== Test 2: selling.promotion.get =====
console.log('\n[Test 2/3] jd.union.open.selling.promotion.get (工具商版转链)');
try {
  const raw = await callJd('jd.union.open.selling.promotion.get', {
    promotionCodeReq: {
      materialId: `https://item.jd.com/${TEST_SKU}.html`,
      pid: buildPid(),
      subUnionId: 'ocp_test_agent_001',
    },
  });
  dump('selling.promotion.get', raw);
} catch (e) {
  console.log(`  ❌ ${e instanceof Error ? e.message : e}`);
}

// ===== Test 3: selling.order.row.query =====
console.log('\n[Test 3/3] jd.union.open.selling.order.row.query (工具商版订单)');
try {
  const now = new Date();
  const start = new Date(now.getTime() - 60 * 60 * 1000);
  const raw = await callJd('jd.union.open.selling.order.row.query', {
    orderReq: {
      type: 1,
      startTime: formatBeijingTimestamp(start),
      endTime: formatBeijingTimestamp(now),
      pageNo: 1,
      pageSize: 10,
    },
  });
  dump('selling.order.row.query', raw);
} catch (e) {
  console.log(`  ❌ ${e instanceof Error ? e.message : e}`);
}

console.log('\n' + '─'.repeat(64));
console.log('如果 3 个都返回 outer code=0 且内层 code=200,工具商通路就打通了。');
console.log('内层字段名(field xxx)很关键 — client.ts 里要按这个改 wrapperKey 和 dataField。');
