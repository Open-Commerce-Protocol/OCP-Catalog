import type { AppConfig } from '@ocp-catalog/config';
import type { Db } from '@ocp-catalog/db';
import { buildCatalogManifest, buildWellKnownDiscovery } from './contracts';
import { ObjectSyncService } from './object-sync-service';
import { RegistrationService } from './registration-service';
import { ResolveService } from './resolve-service';
import type { CatalogScenarioModule } from './scenario';

export { buildCatalogManifest, buildWellKnownDiscovery };
export { parseFieldRef, readDescriptorField } from './field-ref';
export { asProjection, numberField, stringField, visibleAttributes } from './projection';
export { RegistrationService } from './registration-service';
export { ObjectSyncService } from './object-sync-service';
export { ResolveService } from './resolve-service';
export { defaultProviderFieldRules } from './scenario';
export type { CatalogScenarioModule, DescriptorValidationResult, SearchProjection } from './scenario';

export function createCatalogServices(
  db: Db,
  config: AppConfig,
  scenario: CatalogScenarioModule,
) {
  const registrationService = new RegistrationService(db, config, scenario);
  const objectSyncService = new ObjectSyncService(db, config, registrationService, scenario);
  const resolveService = new ResolveService(db, config, scenario);

  return {
    registrations: registrationService,
    objects: objectSyncService,
    resolve: resolveService,
  };
}
