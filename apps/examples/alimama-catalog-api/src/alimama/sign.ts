import { createHash, createHmac } from 'node:crypto';

/**
 * 淘宝开放平台 (Top) API 签名算法。
 *
 * 算法（来自官方文档）：
 *   1. 把所有参数按 key 字典序排序
 *   2. 把排序后的 key+value 直接拼接成一个字符串
 *   3. md5 模式: MD5( appSecret + concat + appSecret )
 *      hmac-sha256 模式: HMAC-SHA256( appSecret ).update( concat )
 *   4. 取大写 16 进制
 *
 * 注意：
 *   - 调用方负责把 number/boolean 转成 string 再传进来。
 *   - 不签 'sign' 字段本身（如果传了会被一并签，调用方应自己排除）。
 *   - 实际使用时建议先剔除值为 undefined 的字段。
 *
 * @param params      已 stringify 的参数集合（含系统参数 method/app_key/v/timestamp 等）
 * @param appSecret   应用密钥
 * @param method      签名算法，默认 'md5'。新 API 推荐用 'hmac-sha256'
 * @returns           32 (md5) 或 64 (hmac-sha256) 字符的大写 16 进制字符串
 */
export function topSign(
  params: Record<string, string>,
  appSecret: string,
  method: 'md5' | 'hmac-sha256' = 'md5',
): string {
  const sortedKeys = Object.keys(params).sort();
  const concat = sortedKeys.map((k) => k + params[k]).join('');

  if (method === 'md5') {
    return createHash('md5')
      .update(appSecret + concat + appSecret, 'utf8')
      .digest('hex')
      .toUpperCase();
  }

  return createHmac('sha256', appSecret).update(concat, 'utf8').digest('hex').toUpperCase();
}
