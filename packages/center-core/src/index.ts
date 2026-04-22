import type { AppConfig } from '@ocp-catalog/config';
import type { Db } from '@ocp-catalog/db';
import { CatalogRegistryService } from './catalog-registry-service';

export { buildCenterDiscovery, buildCenterManifest } from './manifest';
export { CatalogRegistryService } from './catalog-registry-service';
export { fetchCatalogProfile, validateFetchedCatalog } from './catalog-fetcher';
export { startCatalogRefreshScheduler } from './refresh-scheduler';

export function createCenterServices(db: Db, config: AppConfig) {
  return {
    catalogs: new CatalogRegistryService(db, config),
  };
}
