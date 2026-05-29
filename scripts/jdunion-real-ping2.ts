/**
 * JD Union 真实接口探针 v2 — 验证 3 个已开通的接口能否跑通。
 *
 * 你的账号属于"工具商 / Agent贸易"类型,jd.union.open.goods.query 不在权限列表。
 * 但 promotiongoodsinfo.query / promotion.common.get / order.row.query 都已开通。
 * 这个脚本验证后 3 个能否真实工作。
 */
process.env.JDUNION_MOCK = 'false';

const { loadJdUnionConfig } = await import(
  '../apps/examples/jdunion-catalog-api/src/config'
);
const { JdUnionClient, JdApiError, formatBeijingTimestamp } = await import(
  '../apps/examples/jdunion-catalog-api/src/jd/client'
);

const cfg = loadJdUnionConfig();
const client = new JdUnionClient(cfg);
const TEST_SKU = process.env.JDUNION_TEST_SKU_ID ?? '100248969231';

console.log('\nJD Union real ping v2 (skip goods.query, test the 3 已开通)');
console.log('─'.repeat(64));
console.log(`Gateway:    ${cfg.JDUNION_BASE_URL}`);
console.log(`UnionID:    ${cfg.JDUNION_UNION_ID}`);
console.log(`PositionID: ${cfg.JDUNION_POSITION_ID}`);
console.log(`Test SKU:   ${TEST_SKU}`);
console.log('─'.repeat(64));

// ===== Test 1: SKU 详情 + 转链 (promotiongoodsinfo.query) =====
console.log('\n[Test 1/3] jd.union.open.goods.promotiongoodsinfo.query');
let promotionUrl = '';
try {
  const result = await client.getPromotionGoodsInfo({
    skuIds: [TEST_SKU],
    positionId: cfg.JDUNION_POSITION_ID,
  });
  const item = result.result?.[0];
  if (!item) {
    console.log('  🟡 OK 但 SKU 不在联盟物料库 (result 空数组)');
    console.log('     → 换一个真实在售的京东自营 SKU 重试');
  } else {
    console.log(`  ✅ OK  skuId=${item.skuId}`);
    console.log(`     name: ${(item.skuName ?? '').slice(0, 50)}`);
    console.log(`     佣金率: ${item.commissionInfo?.commissionShare ?? '?'}  价格: ¥${item.priceInfo?.price ?? '?'}`);
    console.log(`     materialUrl: ${item.materialUrl ?? '(none)'}`);
  }
} catch (e) {
  printError(e, 'promotiongoodsinfo.query');
}

// ===== Test 2: 显式转链 (promotion.common.get) =====
console.log('\n[Test 2/3] jd.union.open.promotion.common.get');
try {
  const result = await client.getPromotionCommonLink({
    materialId: `https://item.jd.com/${TEST_SKU}.html`,
    positionId: cfg.JDUNION_POSITION_ID,
    subUnionId: 'ocp_test_agent_001',
  });
  console.log(`  ✅ OK`);
  console.log(`     shortURL:  ${result.shortURL ?? '(none)'}`);
  console.log(`     clickURL:  ${(result.clickURL ?? '').slice(0, 80)}...`);
  promotionUrl = result.shortURL ?? '';
} catch (e) {
  printError(e, 'promotion.common.get');
}

// ===== Test 3: 订单查询 (order.row.query) =====
// JD 强制单次查询窗口 ≤ 1 小时,只能拉最近 1 小时的样本验证连通
console.log('\n[Test 3/3] jd.union.open.order.row.query (查最近 1 小时,JD 强制窗口上限)');
try {
  const now = new Date();
  const start = new Date(now.getTime() - 60 * 60 * 1000);
  const result = await client.listOrderRows({
    type: 1,
    startTime: formatBeijingTimestamp(start),
    endTime: formatBeijingTimestamp(now),
    pageNo: 1,
    pageSize: 10,
  });
  console.log(`  ✅ OK  hasMore=${result.hasMore ?? '?'}  rows=${result.data?.length ?? 0}`);
  if ((result.data?.length ?? 0) === 0) {
    console.log('     (正常,新账号还没产生订单)');
  } else {
    console.log(`     first row: id=${result.data?.[0]?.id}`);
  }
} catch (e) {
  printError(e, 'order.row.query');
}

console.log('\n' + '─'.repeat(64));
if (promotionUrl) {
  console.log('🎉 真实链路打通!');
  console.log(`   你可以点击这个短链验证: ${promotionUrl}`);
  console.log('');
  console.log('   下一步: 我把 query.ts 改成用 goods.material.query (已开通) 替代 goods.query');
  console.log('          这是工具商账号该用的"商品发现"接口');
}

function printError(e: unknown, where: string) {
  if (e instanceof JdApiError) {
    console.log(`  ❌ FAIL [${where}]`);
    console.log(`     subCode: ${e.subCode}`);
    console.log(`     message: ${e.message}`);
    console.log(`     details: ${JSON.stringify(e.details).slice(0, 400)}`);
  } else if (e instanceof Error) {
    console.log(`  ❌ FAIL [${where}] ${e.name}: ${e.message}`);
  } else {
    console.log(`  ❌ FAIL [${where}] ${String(e)}`);
  }
}
