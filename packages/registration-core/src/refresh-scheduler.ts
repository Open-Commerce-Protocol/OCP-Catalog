import type { AdvisoryLockService } from '@ocp-catalog/db';
import type { RegistrationRefreshSchedulerConfig } from './config';
import type { CatalogRegistryService } from './catalog-registry-service';

export type RefreshScheduler = {
  stop: () => void;
};

export function startCatalogRefreshScheduler(
  catalogs: CatalogRegistryService,
  config: RegistrationRefreshSchedulerConfig,
  coordination: AdvisoryLockService,
  log: Pick<Console, 'log' | 'error'> = console,
): RefreshScheduler | null {
  if (!config.refreshSchedulerEnabled) return null;

  const intervalMs = config.refreshIntervalSeconds * 1000;
  let running = false;

  const run = async () => {
    if (running) return;
    running = true;
    try {
      const lockName = `ocp:registration:${config.registrationId}:catalog-refresh`;
      const lockedResult = await coordination.withLock(lockName, () => catalogs.refreshDueCatalogs());
      if (!lockedResult.acquired) {
        log.log(`OCP Catalog Registration refresh skipped because another instance owns ${lockName}`);
        return;
      }
      const result = lockedResult.value;
      if (result.scanned_count > 0) {
        log.log(
          `OCP Catalog Registration refresh scanned ${result.scanned_count}, refreshed ${result.refreshed_count}, failed ${result.failed_count}`,
        );
      }
    } catch (error) {
      log.error('OCP Catalog Registration refresh scheduler failed', error);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void run();
  }, intervalMs);

  void run();

  return {
    stop: () => clearInterval(timer),
  };
}
