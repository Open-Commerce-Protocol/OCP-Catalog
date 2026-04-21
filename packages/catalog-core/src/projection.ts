import { isRecord } from './field-ref';

export function visibleAttributes(projection: Record<string, unknown>) {
  const hidden = new Set(['text']);
  return Object.fromEntries(Object.entries(projection).filter(([key]) => !hidden.has(key)));
}

export function stringField(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function numberField(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function asProjection(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
