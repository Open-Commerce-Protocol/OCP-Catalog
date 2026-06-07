import { describe, expect, test } from 'bun:test';
import type { AppConfig } from '@ocp-catalog/config';
import type { AdvisoryLockService } from '@ocp-catalog/db';
import { startCatalogRefreshScheduler } from './refresh-scheduler';

describe('startCatalogRefreshScheduler', () => {
  test('skips refresh when another instance owns the distributed lock', async () => {
    let refreshCount = 0;
    const lockNames: string[] = [];
    const logs: string[] = [];

    const scheduler = startCatalogRefreshScheduler(
      {
        async refreshDueCatalogs() {
          refreshCount += 1;
          return refreshResult();
        },
      } as never,
      schedulerConfig(),
      {
        async withLock(lockName) {
          lockNames.push(lockName);
          return { acquired: false };
        },
      } satisfies AdvisoryLockService,
      { log: (message: string) => logs.push(String(message)), error: () => {} },
    );

    await settleSchedulerTick();
    scheduler?.stop();

    expect(refreshCount).toBe(0);
    expect(lockNames).toEqual(['ocp:registration:reg_test:catalog-refresh']);
    expect(logs).toEqual(['OCP Catalog Registration refresh skipped because another instance owns ocp:registration:reg_test:catalog-refresh']);
  });

  test('runs refresh only after acquiring the distributed lock', async () => {
    let refreshCount = 0;

    const scheduler = startCatalogRefreshScheduler(
      {
        async refreshDueCatalogs() {
          refreshCount += 1;
          return refreshResult({ scanned_count: 1, refreshed_count: 1 });
        },
      } as never,
      schedulerConfig(),
      {
        async withLock(_lockName, fn) {
          return {
            acquired: true,
            value: await fn(),
          };
        },
      } satisfies AdvisoryLockService,
      { log: () => {}, error: () => {} },
    );

    await settleSchedulerTick();
    scheduler?.stop();

    expect(refreshCount).toBe(1);
  });
});

function schedulerConfig(): AppConfig {
  return {
    REGISTRATION_REFRESH_SCHEDULER_ENABLED: true,
    REGISTRATION_REFRESH_INTERVAL_SECONDS: 60,
    REGISTRATION_ID: 'reg_test',
  } as AppConfig;
}

type RefreshDueCatalogsResult = {
  scanned_count: number;
  refreshed_count: number;
  failed_count: number;
  results: unknown[];
};

function refreshResult(overrides: Partial<RefreshDueCatalogsResult> = {}): RefreshDueCatalogsResult {
  return {
    scanned_count: 0,
    refreshed_count: 0,
    failed_count: 0,
    results: [],
    ...overrides,
  };
}

async function settleSchedulerTick() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
