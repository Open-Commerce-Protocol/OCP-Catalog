import type { AppConfig } from '@ocp-catalog/config';
import type { CatalogRegistryService } from './catalog-registry-service';

export type RefreshScheduler = {
  stop: () => void;
};

export function startCatalogRefreshScheduler(
  catalogs: CatalogRegistryService,
  config: AppConfig,
  log: Pick<Console, 'log' | 'error'> = console,
): RefreshScheduler | null {
  if (!config.CENTER_REFRESH_SCHEDULER_ENABLED) return null;

  const intervalMs = config.CENTER_REFRESH_INTERVAL_SECONDS * 1000;
  let running = false;

  const run = async () => {
    if (running) return;
    running = true;
    try {
      const result = await catalogs.refreshDueCatalogs();
      if (result.scanned_count > 0) {
        log.log(
          `OCP Center refresh scanned ${result.scanned_count}, refreshed ${result.refreshed_count}, failed ${result.failed_count}`,
        );
      }
    } catch (error) {
      log.error('OCP Center refresh scheduler failed', error);
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
