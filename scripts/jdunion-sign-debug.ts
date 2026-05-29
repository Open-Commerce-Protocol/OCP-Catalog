/**
 * JD Union 签名调试 — 把签名前/后所有信息打印出来,人工对照 JD 官方文档校验。
 *
 * 不走 client.ts 的封装,完全手动一步步构造请求,目的是隔离问题:
 *   - sign.ts 算法本身错误?
 *   - timestamp 时区错误?
 *   - 360buy_param_json 内容错误?
 *   - secret 有 trailing 空格?
 */
import { jdSign } from '../apps/examples/jdunion-catalog-api/src/jd/sign';
import { formatBeijingTimestamp } from '../apps/examples/jdunion-catalog-api/src/jd/client';

const APP_KEY = process.env.JDUNION_APP_KEY!;
const APP_SECRET = process.env.JDUNION_APP_SECRET!;
const BASE_URL = process.env.JDUNION_BASE_URL ?? 'https://router.jd.com/api';

console.log('\n=== JD Union 签名调试 ===\n');

// 1. 验证 secret/key 没有隐藏字符
console.log('[Step 1] 凭据字面值校验');
console.log(`  APP_KEY    长度=${APP_KEY.length}  hex?=${/^[0-9a-f]+$/.test(APP_KEY)}  尾字符=${JSON.stringify(APP_KEY.slice(-1))}`);
console.log(`  APP_SECRET 长度=${APP_SECRET.length}  hex?=${/^[0-9a-f]+$/.test(APP_SECRET)}  尾字符=${JSON.stringify(APP_SECRET.slice(-1))}`);

// 2. 构造请求时间戳
console.log('\n[Step 2] 时间戳');
const now = new Date();
const ts = formatBeijingTimestamp(now);
console.log(`  本机 ISO   : ${now.toISOString()}`);
console.log(`  本机 local : ${now.toString()}`);
console.log(`  发给 JD 的 : ${ts}  (北京时区 yyyy-MM-dd HH:mm:ss)`);

// 3. 构造业务参数(最简单的 goods.query 无关键词)
const bizParams = {
  goodsReqDTO: {
    pageIndex: 1,
    pageSize: 2,
  },
};
const paramJson = JSON.stringify(bizParams);
console.log('\n[Step 3] 业务参数 (360buy_param_json)');
console.log(`  JSON 字符串: ${paramJson}`);

// 4. 构造系统参数
const sysParams: Record<string, string> = {
  method: 'jd.union.open.goods.query',
  app_key: APP_KEY,
  format: 'json',
  v: '1.0',
  sign_method: 'md5',
  timestamp: ts,
  '360buy_param_json': paramJson,
};
console.log('\n[Step 4] 全部参与签名的 params');
for (const [k, v] of Object.entries(sysParams)) {
  console.log(`  ${k.padEnd(20)} = ${v.length > 80 ? v.slice(0, 77) + '...' : v}`);
}

// 5. 签名拼接串
const sortedKeys = Object.keys(sysParams).sort();
const concat = sortedKeys.map((k) => k + sysParams[k]).join('');
console.log('\n[Step 5] 排序后拼接串 (sorted key+value)');
console.log(`  长度: ${concat.length}`);
console.log(`  前 200 字符: ${concat.slice(0, 200)}`);

// 6. 计算签名
const sign = jdSign(sysParams, APP_SECRET, 'md5');
console.log('\n[Step 6] 签名');
console.log(`  MD5(secret + concat + secret) 大写: ${sign}`);

// 7. 拼最终请求体
const signed = { ...sysParams, sign };
const body = new URLSearchParams(signed).toString();
console.log('\n[Step 7] POST body (URL encoded)');
console.log(`  长度: ${body.length}`);
console.log(`  body (脱敏 app_key/sign):`);
console.log(`    ${body.replace(APP_KEY, '<APP_KEY>').replace(sign, '<SIGN>')}`);

// 8. 实际发请求
console.log('\n[Step 8] 发起请求');
const res = await fetch(BASE_URL, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body,
});
console.log(`  HTTP ${res.status} ${res.statusText}`);
const text = await res.text();
console.log(`  响应 body:`);
console.log(`    ${text.slice(0, 800)}`);
console.log('');
