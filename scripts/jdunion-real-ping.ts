/**
 * JD Union 真实接口探针 — 验证凭据 + 签名 + 网关可达性。
 *
 * 用途:在审核状态不明、不想跑完整 smoke 的情况下,用一次最低风险的 API 调用
 *       探一下 JD 网关是否接受我们的凭据。
 *
 * 流程:
 *   1. 加载 .env (强制 JDUNION_MOCK=false)
 *   2. 调一次 jd.union.open.goods.query (keyword="耳机", pageSize=2)
 *      — 这是 JD 联盟最基础的只读接口,对资质要求最低
 *   3. 打印结果或错误码,人工解读
 *
 * 用法:
 *   bun scripts/jdunion-real-ping.ts
 *
 * 可能的结果解读:
 *   ✅ "OK / N items"            → 凭据没问题,可以进入真实 smoke
 *   🟠 "invalid_sign"            → 签名算法不对(不应该,代码已有 30 测试覆盖)
 *   🟠 "invalid_appkey"          → AppKey 错误,核对 .env
 *   🟠 "invalid_pid"             → 推广位类型问题(导购媒体可能要求 3 段 PID)
 *   ❌ "subject_unaudit / no_permission / ip_limit" → 审核未通过 / 权限不足,需要等
 *   ❌ HTTP 5xx                  → JD 网关临时故障,稍后重试
 */
// Bun 自动加载根目录 .env,这里只强制覆盖 mock 开关
process.env.JDUNION_MOCK = 'false';

const { loadJdUnionConfig } = await import(
  '../apps/examples/jdunion-catalog-api/src/config'
);
const { JdUnionClient, JdApiError } = await import(
  '../apps/examples/jdunion-catalog-api/src/jd/client'
);

const cfg = loadJdUnionConfig();

console.log('\nJD Union real ping');
console.log('─'.repeat(60));
console.log(`UnionID:    ${cfg.JDUNION_UNION_ID}`);
console.log(`AppKey:     ${cfg.JDUNION_APP_KEY?.slice(0, 8)}...${cfg.JDUNION_APP_KEY?.slice(-4)}`);
console.log(`PositionID: ${cfg.JDUNION_POSITION_ID}`);
console.log(`Gateway:    ${cfg.JDUNION_BASE_URL}`);
console.log('─'.repeat(60));

const client = new JdUnionClient(cfg);

// 先试最低风险:无 pid 的 goods.query (只验证 鉴权 + 签名 + 网关)
console.log('\n[Test 1/2] goods.query  keyword="耳机" pageSize=2  (无 pid,验证鉴权 + 签名)');
try {
  const result = await client.listGoods({
    keyword: '耳机',
    pageIndex: 1,
    pageSize: 2,
  });
  console.log(`  ✅ OK  code=${result.code}  totalCount=${result.totalCount}  items=${result.data?.length ?? 0}`);
  if (result.data?.[0]) {
    const item = result.data[0];
    console.log(`     first: skuId=${item.skuId}  name=${(item.skuName ?? '').slice(0, 30)}...`);
  }
} catch (e) {
  printError(e, 'goods.query');
  console.log('\n  ⚠️  鉴权/签名层就失败,下面的 PID 验证就不跑了。');
  process.exit(1);
}

// 再试带 pid 的(验证推广位绑定是否生效)
console.log(`\n[Test 2/2] goods.query  keyword="耳机"  positionId=${cfg.JDUNION_POSITION_ID}  (验证 PID 是否被接受)`);
try {
  const result = await client.listGoods({
    keyword: '耳机',
    pageIndex: 1,
    pageSize: 2,
    positionId: cfg.JDUNION_POSITION_ID,
  });
  console.log(`  ✅ OK  PID 格式 "${cfg.JDUNION_UNION_ID}_${cfg.JDUNION_POSITION_ID}" 被接受`);
  console.log(`     code=${result.code}  items=${result.data?.length ?? 0}`);
} catch (e) {
  printError(e, 'goods.query (with PID)');
  console.log(
    `\n  ⚠️  无 PID 通,带 PID 失败 → 大概率是"导购媒体"类型 PID 格式问题。\n` +
    `      当前传的 PID:  ${cfg.JDUNION_UNION_ID}_${cfg.JDUNION_POSITION_ID}\n` +
    `      联盟后台显示: ${cfg.JDUNION_UNION_ID}_4104975230_${cfg.JDUNION_POSITION_ID}\n` +
    `      可能要在 client.ts 里改成 3 段拼接。`,
  );
  process.exit(2);
}

console.log('\n' + '─'.repeat(60));
console.log('✅ 两步都过,凭据 + 签名 + PID 全 OK,可以进入完整真实 smoke。');
console.log('   下一步: bun scripts/jdunion-real-smoke.ts  (我会写)');

function printError(e: unknown, where: string) {
  if (e instanceof JdApiError) {
    console.log(`  ❌ FAIL  [${where}]`);
    console.log(`     subCode: ${e.subCode}`);
    console.log(`     message: ${e.message}`);
    if (e.details) {
      console.log(`     details: ${JSON.stringify(e.details).slice(0, 400)}`);
    }
  } else if (e instanceof Error) {
    console.log(`  ❌ FAIL  [${where}]  ${e.name}: ${e.message}`);
  } else {
    console.log(`  ❌ FAIL  [${where}]  ${String(e)}`);
  }
}
