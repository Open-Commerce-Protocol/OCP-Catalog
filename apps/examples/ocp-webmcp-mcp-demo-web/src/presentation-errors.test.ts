import { expect, test } from 'bun:test';
import { toUserFacingError } from './presentation-errors';

test('maps technical HTTP failures to a professional user-facing message', () => {
  const error = toUserFacingError(new Error('Catalog query failed: HTTP 502'));

  expect(error.userMessage).toBe('服务暂时不可用，请稍后再试。');
  expect(error.diagnosticMessage).toBe('Catalog query failed: HTTP 502');
});

test('maps manifest failures without exposing internal endpoint details', () => {
  const error = toUserFacingError(new Error('Catalog manifest fetch failed: HTTP 503'));

  expect(error.userMessage).toBe('部分数据源暂时不可用，请稍后再试。');
  expect(error.diagnosticMessage).toBe('Catalog manifest fetch failed: HTTP 503');
});

test('does not hide validation messages that users can fix', () => {
  const error = toUserFacingError(new Error('semantic query_mode requires query text'));

  expect(error.userMessage).toBe('semantic query_mode requires query text');
  expect(error.diagnosticMessage).toBe('semantic query_mode requires query text');
});
