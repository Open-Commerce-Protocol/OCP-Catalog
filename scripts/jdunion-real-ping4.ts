/**
 * JD Union 真实接口探针 v4 — 验证新版工具商接口。
 *
 * selling.* 已停用,根据 JD 升级指引应该改用:
 *   - 转链:  promotion.bysubunionid.get / promotion.byunionid.get
 *   - 商品池: goods.jingfen.query  (无需申请,权限页显示已开通)
 *   - 推荐:  goods.material.query (无需申请,权限页显示已开通)
 *
 * 跑完这 4 个看哪几条能通,然后选最合适的接进 client.ts。
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

console.log('\nJD Union real ping v4 — new-gen 工具商接口');
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

function dump(raw: any) {
  if (raw.error_response) {
    console.log(`  ❌ gateway: code=${raw.error_response.code} ${raw.error_response.zh_desc ?? raw.error_response.msg}`);
    return;
  }
  const wrapperKey = Object.keys(raw)[0];
  console.log(`  wrapperKey: ${wrapperKey}`);
  const envelope = raw[wrapperKey];
  console.log(`  outer code: ${envelope?.code}`);
  for (const [k, v] of Object.entries(envelope ?? {})) {
    if (k === 'code') continue;
    const text = typeof v === 'string' ? v : JSON.stringify(v);
    // 内层 JSON 可能很长,看前 300 字符就够
    console.log(`  ${k}: ${text.slice(0, 300)}${text.length > 300 ? '...' : ''}`);
    // 若是内层 JSON 字符串,尝试解析顶层 code/message
    if (typeof v === 'string' && (v.startsWith('{') || v.startsWith('['))) {
      try {
        const inner = JSON.parse(v);
        if (inner.code !== undefined) {
          console.log(`     → inner code=${inner.code} message=${inner.message ?? ''}`);
        }
      } catch {}
    }
  }
}

// ===== Test 1: promotion.bysubunionid.get =====
console.log('\n[1] jd.union.open.promotion.bysubunionid.get  转链(子渠道)');
try {
  const raw = await callJd('jd.union.open.promotion.bysubunionid.get', {
    promotionCodeReq: {
      materialId: `https://item.jd.com/${TEST_SKU}.html`,
      subUnionId: 'ocp_test_agent_001',
      positionId: Number(cfg.JDUNION_POSITION_ID),
      pid: buildPid(),
    },
  });
  dump(raw);
} catch (e) {
  console.log(`  ❌ ${e instanceof Error ? e.message : e}`);
}

// ===== Test 2: promotion.byunionid.get =====
console.log('\n[2] jd.union.open.promotion.byunionid.get  转链(总)');
try {
  const raw = await callJd('jd.union.open.promotion.byunionid.get', {
    promotionCodeReq: {
      materialId: `https://item.jd.com/${TEST_SKU}.html`,
      unionId: Number(cfg.JDUNION_UNION_ID),
      positionId: Number(cfg.JDUNION_POSITION_ID),
      pid: buildPid(),
    },
  });
  dump(raw);
} catch (e) {
  console.log(`  ❌ ${e instanceof Error ? e.message : e}`);
}

// ===== Test 3: goods.jingfen.query  京粉精选商品池 =====
console.log('\n[3] jd.union.open.goods.jingfen.query  京粉精选(eliteId=1 好券)');
try {
  const raw = await callJd('jd.union.open.goods.jingfen.query', {
    goodsReq: {
      eliteId: 1,
      pageIndex: 1,
      pageSize: 5,
      pid: buildPid(),
    },
  });
  dump(raw);
} catch (e) {
  console.log(`  ❌ ${e instanceof Error ? e.message : e}`);
}

// ===== Test 4: goods.material.query  猜你喜欢 =====
console.log('\n[4] jd.union.open.goods.material.query  猜你喜欢推荐');
try {
  const raw = await callJd('jd.union.open.goods.material.query', {
    pageIndex: 1,
    pageSize: 5,
    pid: buildPid(),
  });
  dump(raw);
} catch (e) {
  console.log(`  ❌ ${e instanceof Error ? e.message : e}`);
}

console.log('\n' + '─'.repeat(64));
console.log('找出 inner code=200 的就是工具商可用的接口。');
