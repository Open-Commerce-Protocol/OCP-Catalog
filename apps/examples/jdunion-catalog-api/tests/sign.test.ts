import { describe, expect, test } from 'bun:test';
import { jdSign } from '../src/jd/sign';

/**
 * 模拟一次真实 JD Union 请求时被签的 params 集合。
 *
 * 注意: 实际使用时业务参数会被 client 层包成 360buy_param_json 一个字符串字段。
 * 这里的 fixture 就模拟了打包后的最终形态。
 */
const sampleParams = {
  method: 'jd.union.open.goods.query',
  app_key: 'test_app_key',
  format: 'json',
  v: '1.0',
  sign_method: 'md5',
  timestamp: '2026-05-18 10:00:00',
  '360buy_param_json': JSON.stringify({
    goodsReq: { keyword: '无线耳机', pageIndex: 1, pageSize: 20 },
  }),
};

describe('jdSign', () => {
  test('md5: 输出 32 字符大写 16 进制', () => {
    const sig = jdSign(sampleParams, 'secret');
    expect(sig).toMatch(/^[A-F0-9]{32}$/);
  });

  test('md5: 相同输入产生相同签名(确定性)', () => {
    const sig1 = jdSign(sampleParams, 'secret');
    const sig2 = jdSign(sampleParams, 'secret');
    expect(sig1).toEqual(sig2);
  });

  test('md5: 参数顺序不影响签名(内部会排序)', () => {
    const a = jdSign({ b: '2', a: '1', c: '3' }, 'sec');
    const b = jdSign({ c: '3', a: '1', b: '2' }, 'sec');
    expect(a).toEqual(b);
  });

  test('md5: 不同的 secret 产生不同签名', () => {
    const a = jdSign(sampleParams, 'secret_1');
    const b = jdSign(sampleParams, 'secret_2');
    expect(a).not.toEqual(b);
  });

  test('md5: 改一个 system param 值就改变签名', () => {
    const a = jdSign(sampleParams, 'sec');
    const b = jdSign({ ...sampleParams, timestamp: '2026-05-18 10:00:01' }, 'sec');
    expect(a).not.toEqual(b);
  });

  test('md5: 改 360buy_param_json 的内容也改变签名', () => {
    const a = jdSign(sampleParams, 'sec');
    const b = jdSign(
      {
        ...sampleParams,
        '360buy_param_json': JSON.stringify({
          goodsReq: { keyword: '充电宝', pageIndex: 1, pageSize: 20 },
        }),
      },
      'sec',
    );
    expect(a).not.toEqual(b);
  });

  test('md5: 中文 / UTF-8 参数稳定(不报错且产出 32 hex)', () => {
    const sig = jdSign(
      {
        method: 'jd.union.open.goods.query',
        '360buy_param_json': JSON.stringify({ keyword: '无线耳机', cat: '12345' }),
      },
      '密钥123',
    );
    expect(sig).toMatch(/^[A-F0-9]{32}$/);
  });

  test('md5: 与阿里 topSign 在相同输入下产出相同结果 (算法等价性回归)', async () => {
    const { topSign } = await import(
      '../../alimama-catalog-api/src/alimama/sign'
    );
    const sig1 = jdSign(sampleParams, 'secret');
    const sig2 = topSign(sampleParams, 'secret');
    expect(sig1).toEqual(sig2);
  });

  test('hmac-sha256: 输出 64 字符大写 16 进制', () => {
    const sig = jdSign(sampleParams, 'secret', 'hmac-sha256');
    expect(sig).toMatch(/^[A-F0-9]{64}$/);
  });

  test('hmac-sha256 与 md5 算出不同签名(同输入)', () => {
    const md5Sig = jdSign(sampleParams, 'secret', 'md5');
    const hmacSig = jdSign(sampleParams, 'secret', 'hmac-sha256');
    expect(md5Sig).not.toEqual(hmacSig);
  });
});
