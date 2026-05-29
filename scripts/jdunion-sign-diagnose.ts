/**
 * JD Union 签名诊断 — 跑 4 个变体,通过对比错误码定位问题。
 *
 * 标准变体 V1 已知报 code=12 "无效签名"。这个脚本另外跑 3 个变体,
 * 关注:有没有任何变体返回**不同的错误码** —— 那就是线索方向。
 */
import { createHash } from 'node:crypto';

const APP_KEY = process.env.JDUNION_APP_KEY!;
const APP_SECRET = process.env.JDUNION_APP_SECRET!;
const MEDIA_ID = process.env.JDUNION_MEDIA_ID!;
const UNION_ID = process.env.JDUNION_UNION_ID!;
const POSITION_ID = process.env.JDUNION_POSITION_ID!;

function formatBeijingTimestamp(d: Date): string {
  const beijingMs = d.getTime() + 8 * 60 * 60 * 1000;
  return new Date(beijingMs).toISOString().replace('T', ' ').slice(0, 19);
}

function md5Sign(params: Record<string, string>, secret: string): string {
  const sorted = Object.keys(params).sort();
  const concat = sorted.map((k) => k + params[k]).join('');
  return createHash('md5').update(secret + concat + secret, 'utf8').digest('hex').toUpperCase();
}

async function tryVariant(
  name: string,
  gateway: string,
  params: Record<string, string>,
  secret: string,
) {
  const sign = md5Sign(params, secret);
  const body = new URLSearchParams({ ...params, sign }).toString();

  console.log(`\n[${name}]`);
  console.log(`  gateway: ${gateway}`);
  console.log(`  params:  ${JSON.stringify(params).slice(0, 200)}`);
  try {
    const res = await fetch(gateway, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10000),
    });
    const text = await res.text();
    const m = text.match(/"code":"?(\d+)"?/);
    const desc = text.match(/"zh_desc":"([^"]+)"/);
    console.log(`  HTTP ${res.status}  code=${m?.[1] ?? '?'}  ${desc?.[1] ?? text.slice(0, 200)}`);
  } catch (e) {
    console.log(`  ERROR: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const ts = formatBeijingTimestamp(new Date());

// ----- V1 (baseline,已知 code=12 "无效签名") -----
await tryVariant(
  'V1 标准协议(已知失败,作 baseline)',
  'https://router.jd.com/api',
  {
    method: 'jd.union.open.goods.query',
    app_key: APP_KEY,
    format: 'json',
    v: '1.0',
    sign_method: 'md5',
    timestamp: ts,
    '360buy_param_json': JSON.stringify({ goodsReqDTO: { pageIndex: 1, pageSize: 2 } }),
  },
  APP_SECRET,
);

// ----- V2 用 媒体ID 作为 app_key (假设 lowercase appkey 是个别名) -----
await tryVariant(
  'V2 用 媒体ID(4104975230) 作为 app_key',
  'https://router.jd.com/api',
  {
    method: 'jd.union.open.goods.query',
    app_key: MEDIA_ID,
    format: 'json',
    v: '1.0',
    sign_method: 'md5',
    timestamp: ts,
    '360buy_param_json': JSON.stringify({ goodsReqDTO: { pageIndex: 1, pageSize: 2 } }),
  },
  APP_SECRET,
);

// ----- V3 PID 完整 3 段塞进业务参数 -----
await tryVariant(
  'V3 完整 3 段 PID 塞进业务参数',
  'https://router.jd.com/api',
  {
    method: 'jd.union.open.goods.query',
    app_key: APP_KEY,
    format: 'json',
    v: '1.0',
    sign_method: 'md5',
    timestamp: ts,
    '360buy_param_json': JSON.stringify({
      goodsReqDTO: {
        pageIndex: 1,
        pageSize: 2,
        pid: `${UNION_ID}_${MEDIA_ID}_${POSITION_ID}`,
      },
    }),
  },
  APP_SECRET,
);

// ----- V4 切到 api.jd.com (有些 JD API 走这个网关) -----
await tryVariant(
  'V4 切换网关到 api.jd.com',
  'https://api.jd.com/routerjson',
  {
    method: 'jd.union.open.goods.query',
    app_key: APP_KEY,
    format: 'json',
    v: '1.0',
    sign_method: 'md5',
    timestamp: ts,
    '360buy_param_json': JSON.stringify({ goodsReqDTO: { pageIndex: 1, pageSize: 2 } }),
  },
  APP_SECRET,
);

console.log('\n─'.repeat(60));
console.log('诊断指引:');
console.log('  - 所有都 code=12 "无效签名"  → 凭据可能不是用来调联盟API的');
console.log('  - V2 出现不同错误码        → 媒体ID 才是正确的 app_key');
console.log('  - V3 出现不同错误码        → PID 是必须的且必须完整 3 段');
console.log('  - V4 出现不同错误码        → 网关地址错了');
console.log('  - HTTP 404/网关报错        → 那个 URL 不对(正常)');
console.log('');
