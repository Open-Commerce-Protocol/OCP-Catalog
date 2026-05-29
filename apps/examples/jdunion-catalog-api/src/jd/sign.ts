import { createHash, createHmac } from 'node:crypto';

/**
 * 京东开放平台 (JOS) / 京东联盟 API 签名算法。
 *
 * 算法 (与阿里淘宝 TOP 形式相同;为避免跨 example 耦合本文件单独维护):
 *   1. 把所有参数按 key 字典序排序
 *   2. 把排序后的 key+value 直接拼接成一个字符串(无分隔符)
 *   3. md5 模式:   MD5( appSecret + concat + appSecret )
 *      hmac-sha256: HMAC-SHA256( appSecret ).update( concat )
 *   4. 取大写 16 进制
 *
 * JD 与 alimama 在使用层面的关键差异 (不影响本函数实现):
 *   - 业务参数被打成一个 JSON 字符串放在系统参数 `360buy_param_json` 字段里
 *     一并参与签名(也就是说本函数被调用时收到的 params 已经是含 360buy_param_json
 *     的扁平 map)
 *   - timestamp 必须北京时间格式 'YYYY-MM-DD HH:mm:ss'
 *   - sign_method 通常为 'md5'
 *
 * 调用方约定:
 *   - 提前剔除值为 undefined 的字段
 *   - 'sign' 字段不应出现在传入的 params 里
 *   - number / boolean 由调用方先 stringify
 *
 * 真实联调若签名报错,优先排查 3 件事:
 *   1. timestamp 是不是北京时区
 *   2. 360buy_param_json 的 JSON 字符串是否完全等值地参与签名
 *      (注意 JSON.stringify 不保证 key 顺序,但 JD 校验的是字符串字面值,所以
 *       签名时用的字符串与发送时用的字符串必须完全相同)
 *   3. 所有 value 都是 string 类型
 *
 * @param params      已 stringify 的参数集合(含系统参数 + 360buy_param_json)
 * @param appSecret   应用密钥
 * @param method      签名算法,默认 'md5'
 * @returns           32 (md5) 或 64 (hmac-sha256) 字符的大写 16 进制字符串
 */
export function jdSign(
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
