import type { AppConfig } from '@ocp-catalog/config';
import type { Db } from '@ocp-catalog/db';
import { buildCatalogManifest, buildWellKnownDiscovery } from './contracts';
import { ObjectSyncService } from './object-sync-service';
import { ProviderLifecycleService } from './provider-lifecycle-service';
import { RegistrationService } from './registration-service';
import { ResolveService } from './resolve-service';
import type { CatalogScenarioModule } from './scenario';

export { buildCatalogManifest, buildWellKnownDiscovery };
export { parseFieldRef, readDescriptorField } from './field-ref';
export { asProjection, numberField, stringField, visibleAttributes } from './projection';
export { RegistrationService } from './registration-service';
export { ObjectSyncService } from './object-sync-service';
export { ProviderLifecycleService } from './provider-lifecycle-service';
export { ResolveService } from './resolve-service';
export { planCatalogQuery } from './query-planner';
export { defaultProviderFieldRules } from './scenario';
export type { CatalogQueryMode, CatalogQueryPlan } from './query-planner';
export type { CatalogScenarioModule, DescriptorValidationResult, SearchProjection } from './scenario';

export function createCatalogServices(
  db: Db,
  config: AppConfig,
  scenario: CatalogScenarioModule,
) {
  const registrationService = new RegistrationService(db, config, scenario);
  const objectSyncService = new ObjectSyncService(db, config, registrationService, scenario);
  const resolveService = new ResolveService(db, config, scenario);
  const providerLifecycleService = new ProviderLifecycleService(db, config);

  return {
    registrations: registrationService,
    objects: objectSyncService,
    resolve: resolveService,
    providerLifecycle: providerLifecycleService,
  };
}
