/**
 * 看 jingfen.query 返回的商品里有没有自带 affiliate clickURL / shortURL。
 * 若有,工具商通路可以不依赖单独的转链 API:商品池就是 affiliate 化的。
 */
process.env.JDUNION_MOCK = 'false';

const { loadJdUnionConfig } = await import('../apps/examples/jdunion-catalog-api/src/config');
const { jdSign } = await import('../apps/examples/jdunion-catalog-api/src/jd/sign');

const cfg = loadJdUnionConfig();

function buildPid() {
  return cfg.JDUNION_MEDIA_ID
    ? `${cfg.JDUNION_UNION_ID}_${cfg.JDUNION_MEDIA_ID}_${cfg.JDUNION_POSITION_ID}`
    : `${cfg.JDUNION_UNION_ID}_${cfg.JDUNION_POSITION_ID}`;
}

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

const raw: any = await callJd('jd.union.open.goods.jingfen.query', {
  goodsReq: { eliteId: 1, pageIndex: 1, pageSize: 3, pid: buildPid() },
});
const env = raw.jd_union_open_goods_jingfen_query_responce;
const inner = JSON.parse(env.queryResult);
console.log(`inner code=${inner.code} message=${inner.message ?? ''}`);
console.log(`total=${inner.totalCount} returned=${inner.data?.length ?? 0}`);
if (inner.data?.[0]) {
  const first = inner.data[0];
  console.log('\nfirst item — 所有 key:');
  for (const k of Object.keys(first)) {
    const v = first[k];
    const txt = typeof v === 'object' ? JSON.stringify(v).slice(0, 120) : String(v).slice(0, 80);
    console.log(`  ${k}: ${txt}`);
  }
  console.log('\naffiliate 链接字段检查:');
  console.log(`  materialUrl: ${first.materialUrl ?? '(无)'}`);
  console.log(`  clickURL:    ${first.clickURL ?? '(无)'}`);
  console.log(`  shortURL:    ${first.shortURL ?? '(无)'}`);
}
