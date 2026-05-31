import { createHash } from 'node:crypto';

/**
 * 拼多多 (PDD) 开放平台 API 签名算法。
 *
 * 算法 (与 alimama TOP / JD 形式相同;为避免跨 example 耦合本文件单独维护):
 *   1. 把所有参数按 key 字典序排序
 *   2. 把排序后的 key+value 直接拼接成一个字符串(无分隔符)
 *   3. MD5( clientSecret + concat + clientSecret )
 *   4. 取大写 16 进制
 *
 * PDD 与 alimama / JD 在使用层面的关键差异 (不影响本函数实现):
 *   - 业务参数是**扁平 KV**,与 alimama 同形态 (JD 那种 360buy_param_json 嵌套 PDD 没有)
 *   - 系统参数固定 5 个: type / client_id / timestamp / data_type / version
 *   - timestamp 是 **Unix 秒** (不是 'YYYY-MM-DD HH:mm:ss' 形式)
 *   - data_type 通常为 'JSON',version 通常为 'V1'
 *   - PDD 文档不强制要求 sign_method 字段,默认 MD5 即可
 *
 * 调用方约定:
 *   - 提前剔除值为 undefined 的字段
 *   - 'sign' 字段不应出现在传入的 params 里
 *   - number / boolean 由调用方先 stringify
 *
 * 真实联调若签名报错,优先排查 3 件事:
 *   1. timestamp 字段是否是 Unix 秒 (PDD 用秒,不是毫秒,也不是日期字符串)
 *   2. 业务参数里的数组类型 (如 goods_id_list) 是否传成了 JSON 字符串
 *      PDD 要求数组参数 JSON.stringify 后参与签名,而非展开
 *   3. 所有 value 都是 string 类型
 *
 * @param params         已 stringify 的参数集合(含系统参数 + 业务参数)
 * @param clientSecret   PDD 应用 client_secret
 * @returns              32 字符的大写 16 进制字符串
 */
export function pddSign(
  params: Record<string, string>,
  clientSecret: string,
): string {
  const sortedKeys = Object.keys(params).sort();
  const concat = sortedKeys.map((k) => k + params[k]).join('');

  return createHash('md5')
    .update(clientSecret + concat + clientSecret, 'utf8')
    .digest('hex')
    .toUpperCase();
}
