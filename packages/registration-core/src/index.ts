import type { RegistrationDb as Db } from '@ocp-catalog/registration-db';
import type { RegistrationRegistryConfig } from './config';
import { CatalogRegistryService } from './catalog-registry-service';

export { buildRegistrationDiscovery, buildRegistrationManifest } from './manifest';
export { CatalogRegistryService } from './catalog-registry-service';
export { fetchCatalogProfile, validateFetchedCatalog } from './catalog-fetcher';
export { startCatalogRefreshScheduler } from './refresh-scheduler';
export type {
  RegistrationHealthPolicyConfig,
  RegistrationIdentityConfig,
  RegistrationRefreshSchedulerConfig,
  RegistrationRegistryConfig,
} from './config';

export function createRegistrationServices(db: Db, config: RegistrationRegistryConfig) {
  return {
    catalogs: new CatalogRegistryService(db, config),
  };
}
