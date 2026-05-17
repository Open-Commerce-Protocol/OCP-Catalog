import { describe, expect, test } from 'bun:test';
import { topSign } from '../src/alimama/sign';

const sampleParams = {
  method: 'taobao.tbk.dg.material.optional',
  app_key: 'test_app_key',
  v: '2.0',
  format: 'json',
  sign_method: 'md5',
  timestamp: '2026-05-13 10:00:00',
  q: '无线耳机',
};

describe('topSign', () => {
  test('md5: 输出 32 字符大写 16 进制', () => {
    const sig = topSign(sampleParams, 'secret');
    expect(sig).toMatch(/^[A-F0-9]{32}$/);
  });

  test('md5: 相同输入产生相同签名（确定性）', () => {
    const sig1 = topSign(sampleParams, 'secret');
    const sig2 = topSign(sampleParams, 'secret');
    expect(sig1).toEqual(sig2);
  });

  test('md5: 参数顺序不影响签名（内部会排序）', () => {
    const a = topSign({ b: '2', a: '1', c: '3' }, 'sec');
    const b = topSign({ c: '3', a: '1', b: '2' }, 'sec');
    expect(a).toEqual(b);
  });

  test('md5: 不同的 secret 产生不同签名', () => {
    const a = topSign(sampleParams, 'secret_1');
    const b = topSign(sampleParams, 'secret_2');
    expect(a).not.toEqual(b);
  });

  test('md5: 改一个参数值就改变签名', () => {
    const a = topSign(sampleParams, 'sec');
    const b = topSign({ ...sampleParams, q: '充电宝' }, 'sec');
    expect(a).not.toEqual(b);
  });

  test('md5: 中文/UTF-8 参数稳定（不报错且产出 32 hex）', () => {
    const sig = topSign({ q: '无线耳机', cat: '50012870' }, '密钥123');
    expect(sig).toMatch(/^[A-F0-9]{32}$/);
  });

  test('hmac-sha256: 输出 64 字符大写 16 进制', () => {
    const sig = topSign(sampleParams, 'secret', 'hmac-sha256');
    expect(sig).toMatch(/^[A-F0-9]{64}$/);
  });

  test('hmac-sha256 与 md5 算出不同签名（同输入）', () => {
    const md5Sig = topSign(sampleParams, 'secret', 'md5');
    const hmacSig = topSign(sampleParams, 'secret', 'hmac-sha256');
    expect(md5Sig).not.toEqual(hmacSig);
  });
});
