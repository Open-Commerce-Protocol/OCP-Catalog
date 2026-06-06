import { describe, expect, test } from 'bun:test';
import {
  CatalogRegistryService,
  catalogIndexEntryStatus,
  isCatalogIndexVisible,
  nextCatalogHealthState,
} from './catalog-registry-service';

describe('catalog registry health state', () => {
  test('resets failure count and records healthy timestamp after a healthy check', () => {
    const checkedAt = new Date('2026-05-17T00:00:00.000Z');
    const previousUnhealthyAt = new Date('2026-05-16T00:00:00.000Z');

    expect(nextCatalogHealthState({
      healthFailureCount: 4,
      lastHealthyAt: null,
      lastUnhealthyAt: previousUnhealthyAt,
    }, 'healthy', checkedAt)).toEqual({
      healthFailureCount: 0,
      lastHealthyAt: checkedAt,
      lastUnhealthyAt: previousUnhealthyAt,
    });
  });

  test('increments failure count and records unhealthy timestamp after an unhealthy check', () => {
    const checkedAt = new Date('2026-05-17T00:00:00.000Z');
    const previousHealthyAt = new Date('2026-05-16T00:00:00.000Z');

    expect(nextCatalogHealthState({
      healthFailureCount: 2,
      lastHealthyAt: previousHealthyAt,
      lastUnhealthyAt: null,
    }, 'unhealthy', checkedAt)).toEqual({
      healthFailureCount: 3,
      lastHealthyAt: previousHealthyAt,
      lastUnhealthyAt: checkedAt,
    });
  });

  test('marks index entries stale only after the configured unhealthy threshold', () => {
    expect(catalogIndexEntryStatus('unhealthy', 2, 3)).toBe('active');
    expect(catalogIndexEntryStatus('unhealthy', 3, 3)).toBe('stale');
    expect(catalogIndexEntryStatus('healthy', 10, 3)).toBe('active');
  });

  test('derives search visibility from the final index entry status', () => {
    expect(isCatalogIndexVisible(catalogIndexEntryStatus('unhealthy', 2, 3))).toBe(true);
    expect(isCatalogIndexVisible(catalogIndexEntryStatus('unhealthy', 3, 3))).toBe(false);
  });

  test('route hints require projected query_url instead of deriving one from manifestUrl', () => {
    const service = new CatalogRegistryService({} as never, { REGISTRATION_ID: 'reg_test' } as never);
    const row = {
      id: 'idx_missing_query_url',
      catalogId: 'catalog_without_projection_query_url',
      catalogName: 'Catalog Without Projection Query Url',
      description: null,
      manifestUrl: 'https://catalog.example.com/ocp/manifest',
      supportedQueryPacks: [],
      supportedQueryModes: [],
      supportedQueryLanguages: [],
      contentLanguages: [],
      searchProjection: {},
      verificationStatus: 'not_required',
      trustTier: 'declared',
      healthStatus: 'healthy',
      activeSnapshotId: 'catsnap_test',
      updatedAt: new Date('2026-05-17T00:00:00.000Z'),
    };

    expect(() => (
      service as unknown as {
        routeHintFromIndexRow(row: unknown): unknown;
      }
    ).routeHintFromIndexRow(row)).toThrow('missing searchProjection.query_url');
  });
});
