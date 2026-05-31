/**
 * 验证 jd.union.open.user.pid.get — 工具商创建子站长 PID。
 *
 * 假设的工具商归因模型:
 *   1) 调 user.pid.get 为每个 Agent 创建独立子 PID
 *   2) 拼推广 URL 时用这个子 PID,JD 用 PID 做归因
 *   3) 订单回流时按 subUnionId 或 PID 维度区分 Agent
 *
 * 这跟"显式转链"是两套模型,工具商可能用前者。
 */
process.env.JDUNION_MOCK = 'false';

const { loadJdUnionConfig } = await import('../apps/examples/jdunion-catalog-api/src/config');
const { jdSign } = await import('../apps/examples/jdunion-catalog-api/src/jd/sign');

const cfg = loadJdUnionConfig();

function fmtTs(d: Date): string {
  return new Date(d.getTime() + 8 * 3600_000).toISOString().replace('T', ' ').slice(0, 19);
}

async function callJd(method: string, biz: Record<string, unknown>) {
  const paramJson = JSON.stringify(biz);
  const sys = {
    method,
    app_key: cfg.JDUNION_APP_KEY!,
    format: 'json',
    v: '1.0',
    sign_method: 'md5',
    timestamp: fmtTs(new Date()),
    '360buy_param_json': paramJson,
  };
  const signed = { ...sys, sign: jdSign(sys, cfg.JDUNION_APP_SECRET!, 'md5') };
  const res = await fetch(cfg.JDUNION_BASE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(signed).toString(),
  });
  return res.json();
}

console.log('\n[ping6] jd.union.open.user.pid.get — 工具商子 PID 创建\n');

// 尝试不同参数组合(JD 文档对工具商接口的参数描述常常缺失)
const tests = [
  {
    label: 'A: 仅 childUnionId',
    biz: { childUnionId: 'ocp_test_agent_001' },
  },
  {
    label: 'B: childUnionId + promotionType (1=APP/网站)',
    biz: { childUnionId: 'ocp_test_agent_001', promotionType: 1 },
  },
  {
    label: 'C: childUnionId + promotionType + positionName',
    biz: {
      childUnionId: 'ocp_test_agent_001',
      promotionType: 1,
      positionName: 'OCP_Agent_Test',
    },
  },
  {
    label: 'D: 完整 (childUnionId + promotionType + positionName + unionType)',
    biz: {
      childUnionId: 'ocp_test_agent_001',
      promotionType: 1,
      positionName: 'OCP_Agent_Test',
      unionType: 3, // 3=工具商
    },
  },
];

for (const t of tests) {
  console.log(`--- ${t.label} ---`);
  console.log(`req: ${JSON.stringify(t.biz)}`);
  try {
    const raw: any = await callJd('jd.union.open.user.pid.get', t.biz);
    if (raw.error_response) {
      console.log(`  gateway error: code=${raw.error_response.code} ${raw.error_response.zh_desc ?? raw.error_response.msg}`);
    } else {
      const wrapperKey = Object.keys(raw)[0];
      const env = raw[wrapperKey];
      console.log(`  wrapperKey: ${wrapperKey}`);
      console.log(`  outer code: ${env?.code}`);
      for (const [k, v] of Object.entries(env ?? {})) {
        if (k === 'code') continue;
        const txt = typeof v === 'string' ? v : JSON.stringify(v);
        console.log(`  ${k}: ${txt.slice(0, 300)}`);
        if (typeof v === 'string' && v.startsWith('{')) {
          try {
            const inner = JSON.parse(v);
            console.log(`     → inner code=${inner.code} message=${inner.message ?? ''}`);
            if (inner.data) console.log(`     → data: ${JSON.stringify(inner.data).slice(0, 300)}`);
          } catch {}
        }
      }
    }
  } catch (e) {
    console.log(`  ❌ ${e instanceof Error ? e.message : e}`);
  }
  console.log('');
}
