import { describe, expect, test } from 'bun:test';
import { catalogHealthResponseSchema } from './index';

const validHealth = {
  ocp_version: '1.0',
  kind: 'CatalogHealth',
  catalog_id: 'cat_commerce_demo',
  status: 'healthy',
  ready: true,
  checked_at: '2026-05-17T00:00:00.000Z',
  manifest_version: 'manifest_cat_commerce_demo',
  details: {
    provider_count: 3,
  },
  dependencies: [
    {
      name: 'postgres',
      status: 'healthy',
    },
  ],
};

describe('catalogHealthResponseSchema', () => {
  test('accepts a valid CatalogHealth response', () => {
    expect(catalogHealthResponseSchema.safeParse(validHealth).success).toBe(true);
  });

  test('rejects payloads with the wrong kind', () => {
    expect(catalogHealthResponseSchema.safeParse({
      ...validHealth,
      kind: 'CatalogManifest',
    }).success).toBe(false);
  });

  test('rejects invalid health status and timestamps', () => {
    expect(catalogHealthResponseSchema.safeParse({
      ...validHealth,
      status: 'ok',
    }).success).toBe(false);

    expect(catalogHealthResponseSchema.safeParse({
      ...validHealth,
      checked_at: 'not-a-date',
    }).success).toBe(false);
  });

  test('rejects invalid dependency status', () => {
    expect(catalogHealthResponseSchema.safeParse({
      ...validHealth,
      dependencies: [
        {
          name: 'postgres',
          status: 'ok',
        },
      ],
    }).success).toBe(false);
  });

  test('rejects fields outside the JSON Schema contract', () => {
    expect(catalogHealthResponseSchema.safeParse({
      ...validHealth,
      extra: true,
    }).success).toBe(false);

    expect(catalogHealthResponseSchema.safeParse({
      ...validHealth,
      dependencies: [
        {
          name: 'postgres',
          status: 'healthy',
          extra: true,
        },
      ],
    }).success).toBe(false);
  });
});
