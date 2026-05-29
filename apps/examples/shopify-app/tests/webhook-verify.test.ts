import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { classifyProductTopic, verifyWebhookHmac } from '../src/shopify/webhook-verify';

const secret = 'app_secret';

describe('verifyWebhookHmac (webhook delivery — base64)', () => {
  const body = JSON.stringify({ id: 9001, title: 'Pour-Over Coffee Dripper' });
  const valid = createHmac('sha256', secret).update(body).digest('base64');

  test('valid signature', () => {
    expect(verifyWebhookHmac(body, secret, valid)).toBe(true);
  });
  test('wrong signature', () => {
    expect(verifyWebhookHmac(body, secret, 'bad==')).toBe(false);
  });
  test('byte-different body', () => {
    expect(verifyWebhookHmac(body + ' ', secret, valid)).toBe(false);
  });
  test('missing header', () => {
    expect(verifyWebhookHmac(body, secret, undefined)).toBe(false);
  });
});

describe('classifyProductTopic', () => {
  test('known', () => {
    expect(classifyProductTopic('products/create')).toBe('products/create');
    expect(classifyProductTopic('products/update')).toBe('products/update');
    expect(classifyProductTopic('products/delete')).toBe('products/delete');
  });
  test('unknown', () => {
    expect(classifyProductTopic('orders/create')).toBe('unknown');
    expect(classifyProductTopic(undefined)).toBe('unknown');
  });
});
