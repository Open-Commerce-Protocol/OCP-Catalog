import { describe, expect, test } from 'bun:test';
import { pddSign } from '../src/pdd/sign';

/**
 * 模拟一次真实 PDD 请求时被签的 params 集合。
 *
 * PDD 与 JD 的关键差异:
 *   - 业务参数扁平拼接 (与 alimama 同),没有 360buy_param_json 这种 JSON wrapper
 *   - timestamp 是 Unix 秒(纯数字字符串)
 *   - 系统参数固定 5 个: type / client_id / timestamp / data_type / version
 */
const sampleParams = {
  type: 'pdd.ddk.goods.search',
  client_id: 'test_client_id',
  timestamp: '1716040000',
  data_type: 'JSON',
  version: 'V1',
  keyword: '无线耳机',
  page: '1',
  page_size: '20',
};

describe('pddSign', () => {
  test('输出 32 字符大写 16 进制', () => {
    const sig = pddSign(sampleParams, 'secret');
    expect(sig).toMatch(/^[A-F0-9]{32}$/);
  });

  test('相同输入产生相同签名(确定性)', () => {
    const sig1 = pddSign(sampleParams, 'secret');
    const sig2 = pddSign(sampleParams, 'secret');
    expect(sig1).toEqual(sig2);
  });

  test('参数顺序不影响签名(内部会排序)', () => {
    const a = pddSign({ b: '2', a: '1', c: '3' }, 'sec');
    const b = pddSign({ c: '3', a: '1', b: '2' }, 'sec');
    expect(a).toEqual(b);
  });

  test('不同的 client_secret 产生不同签名', () => {
    const a = pddSign(sampleParams, 'secret_1');
    const b = pddSign(sampleParams, 'secret_2');
    expect(a).not.toEqual(b);
  });

  test('改 timestamp 改变签名', () => {
    const a = pddSign(sampleParams, 'sec');
    const b = pddSign({ ...sampleParams, timestamp: '1716040001' }, 'sec');
    expect(a).not.toEqual(b);
  });

  test('改业务参数(keyword)改变签名', () => {
    const a = pddSign(sampleParams, 'sec');
    const b = pddSign({ ...sampleParams, keyword: '充电宝' }, 'sec');
    expect(a).not.toEqual(b);
  });

  test('中文 / UTF-8 参数稳定(不报错且产出 32 hex)', () => {
    const sig = pddSign(
      { type: 'pdd.ddk.goods.search', keyword: '无线耳机', cat_id: '12345' },
      '密钥123',
    );
    expect(sig).toMatch(/^[A-F0-9]{32}$/);
  });

  test('与 alimama topSign 在相同输入下产出相同结果 (算法等价性回归)', async () => {
    const { topSign } = await import(
      '../../alimama-catalog-api/src/alimama/sign'
    );
    const sig1 = pddSign(sampleParams, 'secret');
    const sig2 = topSign(sampleParams, 'secret');
    expect(sig1).toEqual(sig2);
  });

  test('与 JD jdSign 在相同输入下产出相同结果 (算法等价性回归)', async () => {
    const { jdSign } = await import(
      '../../jdunion-catalog-api/src/jd/sign'
    );
    const sig1 = pddSign(sampleParams, 'secret');
    const sig2 = jdSign(sampleParams, 'secret');
    expect(sig1).toEqual(sig2);
  });

  test('数组类型参数 (goods_id_list) 作为 JSON 字符串参与签名', () => {
    // PDD 文档要求数组先 JSON.stringify 再传(也就是当作字符串值参与签名)
    const params = {
      ...sampleParams,
      goods_id_list: JSON.stringify([100012345678, 100023456789]),
    };
    const sig = pddSign(params, 'sec');
    expect(sig).toMatch(/^[A-F0-9]{32}$/);
  });
});
