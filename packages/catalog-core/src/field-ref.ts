import type { CommercialObject } from '@ocp-catalog/ocp-schema';

export type ParsedFieldRef = {
  packId: string;
  path: string[];
};

export function parseFieldRef(fieldRef: string): ParsedFieldRef | null {
  const [packId, pointer] = fieldRef.split('#/');
  if (!packId || !pointer) return null;

  return {
    packId,
    path: pointer.split('/').filter(Boolean).map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~')),
  };
}

export function readDescriptorField(object: CommercialObject, fieldRef: string) {
  const parsed = parseFieldRef(fieldRef);
  if (!parsed) return undefined;

  const descriptor = object.descriptors.find((candidate) => candidate.pack_id === parsed.packId);
  if (!descriptor) return undefined;

  let current: unknown = descriptor.data;
  for (const segment of parsed.path) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }

  return current;
}

export function isPresent(value: unknown) {
  return value !== undefined && value !== null && value !== '';
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
