import type { AppConfig } from '@ocp-catalog/config';
import type { Db } from '@ocp-catalog/db';
import { CatalogRegistryService } from './catalog-registry-service';

export { buildRegistrationDiscovery, buildRegistrationManifest } from './manifest';
export { CatalogRegistryService } from './catalog-registry-service';
export { fetchCatalogProfile, validateFetchedCatalog } from './catalog-fetcher';
export { startCatalogRefreshScheduler } from './refresh-scheduler';

export function createRegistrationServices(db: Db, config: AppConfig) {
  return {
    catalogs: new CatalogRegistryService(db, config),
  };
}
