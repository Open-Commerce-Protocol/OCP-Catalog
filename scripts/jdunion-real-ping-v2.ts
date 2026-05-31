/**
 * v2: 权限开通后的再次验证。
 * 试 3 个 method,看看哪些通,哪些还卡。
 */
process.env.JDUNION_MOCK = 'false';

const { loadJdUnionConfig } = await import('../apps/examples/jdunion-catalog-api/src/config');
const { JdUnionClient, JdApiError } = await import('../apps/examples/jdunion-catalog-api/src/jd/client');

const cfg = loadJdUnionConfig();
const client = new JdUnionClient(cfg);

console.log('\nJD Union real ping v2 (权限开通后)');
console.log('─'.repeat(60));

// Test 1: goods.query 带 pid
console.log(`\n[Test 1] goods.query  keyword="耳机"  positionId=${cfg.JDUNION_POSITION_ID}`);
try {
  const r = await client.listGoods({ keyword: '耳机', pageIndex: 1, pageSize: 2, positionId: cfg.JDUNION_POSITION_ID });
  console.log(`  ✅ code=${r.code}  items=${r.data?.length ?? 0}`);
  if (r.data?.[0]) {
    console.log(`     skuId=${r.data[0].skuId}  name=${(r.data[0].skuName ?? '').slice(0, 30)}`);
  }
} catch (e) {
  reportError(e);
}

// Test 2: promotiongoodsinfo.query 带 pid + 测试 SKU
const testSku = process.env.JDUNION_TEST_SKU_ID ?? '100248969231';
console.log(`\n[Test 2] promotiongoodsinfo.query  skuIds=[${testSku}]  positionId=${cfg.JDUNION_POSITION_ID}`);
try {
  const r = await client.getPromotionGoodsInfo({
    skuIds: [testSku],
    positionId: cfg.JDUNION_POSITION_ID,
  });
  console.log(`  ✅ code=${r.code}  items=${r.result?.length ?? 0}`);
  if (r.result?.[0]) {
    const it: any = r.result[0];
    console.log(`     skuId=${it.skuId}  name=${(it.skuName ?? it.goodsName ?? '').slice(0, 30)}`);
    console.log(`     materialUrl: ${it.materialUrl ?? it.shortURL ?? '(none)'}`);
  }
} catch (e) {
  reportError(e);
}

// Test 3: order.row.query (空时间窗,验证签名通和权限通,不期望真有订单)
console.log(`\n[Test 3] order.row.query  (近 1 小时)`);
const now = new Date();
const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
const fmt = (d: Date) => {
  const beijingMs = d.getTime() + 8 * 60 * 60 * 1000;
  return new Date(beijingMs).toISOString().replace('T', ' ').slice(0, 19);
};
try {
  const r = await client.listOrderRows({
    type: 3,
    startTime: fmt(oneHourAgo),
    endTime: fmt(now),
    pageNo: 1,
    pageSize: 10,
  });
  console.log(`  ✅ code=${r.code}  orders=${r.data?.length ?? 0}`);
} catch (e) {
  reportError(e);
}

console.log('\n─'.repeat(60));

function reportError(e: unknown) {
  if (e instanceof JdApiError) {
    console.log(`  ❌ subCode=${e.subCode}  message=${e.message}`);
    if (e.details) console.log(`     details: ${JSON.stringify(e.details).slice(0, 300)}`);
  } else {
    console.log(`  ❌ ${e instanceof Error ? e.message : String(e)}`);
  }
}
