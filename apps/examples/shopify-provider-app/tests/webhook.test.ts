import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { classifyTopic, verifyShopifyHmac } from '../src/shopify/webhook';

describe('verifyShopifyHmac', () => {
  const secret = 'test_webhook_secret';
  const body = JSON.stringify({ id: 8001001, title: 'Heritage Wool Crewneck Sweater' });
  const validHmac = createHmac('sha256', secret).update(body).digest('base64');

  test('valid signature → true', () => {
    expect(verifyShopifyHmac(body, secret, validHmac)).toBe(true);
  });
  test('wrong signature → false', () => {
    expect(verifyShopifyHmac(body, secret, 'nope==')).toBe(false);
  });
  test('empty signature → false', () => {
    expect(verifyShopifyHmac(body, secret, '')).toBe(false);
  });
  test('byte-different body → false', () => {
    const tampered = body + ' ';
    expect(verifyShopifyHmac(tampered, secret, validHmac)).toBe(false);
  });
});

describe('classifyTopic', () => {
  test('known topics', () => {
    expect(classifyTopic('products/create')).toBe('products/create');
    expect(classifyTopic('products/update')).toBe('products/update');
    expect(classifyTopic('products/delete')).toBe('products/delete');
  });
  test('unknown topic', () => {
    expect(classifyTopic('orders/create')).toBe('unknown');
    expect(classifyTopic(undefined)).toBe('unknown');
  });
});
