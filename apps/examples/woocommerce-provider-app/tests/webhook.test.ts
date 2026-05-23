import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { classifyWcTopic, verifyWcSignature } from '../src/woocommerce/webhook';

describe('verifyWcSignature', () => {
  const secret = 'wc_test_secret';
  const body = JSON.stringify({ id: 901, name: 'Cotton Apron — Olive' });
  const valid = createHmac('sha256', secret).update(body).digest('base64');

  test('valid signature → true', () => {
    expect(verifyWcSignature(body, secret, valid)).toBe(true);
  });
  test('wrong signature → false', () => {
    expect(verifyWcSignature(body, secret, 'nope==')).toBe(false);
  });
  test('byte-different body → false', () => {
    expect(verifyWcSignature(body + ' ', secret, valid)).toBe(false);
  });
});

describe('classifyWcTopic', () => {
  test('known topics', () => {
    expect(classifyWcTopic('product.created')).toBe('product.created');
    expect(classifyWcTopic('product.updated')).toBe('product.updated');
    expect(classifyWcTopic('product.deleted')).toBe('product.deleted');
  });
  test('unknown', () => {
    expect(classifyWcTopic('order.created')).toBe('unknown');
    expect(classifyWcTopic(undefined)).toBe('unknown');
  });
});
