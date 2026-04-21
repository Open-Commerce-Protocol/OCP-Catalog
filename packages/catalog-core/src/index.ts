import type { AppConfig } from '@ocp-catalog/config';
import type { Db } from '@ocp-catalog/db';
import { buildCatalogManifest, buildWellKnownDiscovery } from './contracts';
import { ObjectSyncService } from './object-sync-service';
import { QueryService } from './query-service';
import { RegistrationService } from './registration-service';
import { ResolveService } from './resolve-service';
import type { CatalogScenarioModule } from './scenario';
import type { CatalogEmbeddingService } from './embedding-service';

export { buildCatalogManifest, buildWellKnownDiscovery };
export { parseFieldRef, readDescriptorField } from './field-ref';
export { asProjection, numberField, stringField, visibleAttributes } from './projection';
export { inferQueryMode } from './query-mode';
export { RegistrationService } from './registration-service';
export { ObjectSyncService } from './object-sync-service';
export { QueryService } from './query-service';
export { ResolveService } from './resolve-service';
export { CatalogEmbeddingService } from './embedding-service';
export { defaultProviderFieldRules, findScenarioContract } from './scenario';
export type { CatalogScenarioModule, DescriptorValidationResult, SearchProjection } from './scenario';
export type { EmbeddingProvider, EmbeddingResult } from './embedding-service';

export type CatalogServicesOptions = {
  embeddings?: CatalogEmbeddingService;
};

export function createCatalogServices(
  db: Db,
  config: AppConfig,
  scenario: CatalogScenarioModule,
  options: CatalogServicesOptions = {},
) {
  const registrationService = new RegistrationService(db, config, scenario);
  const objectSyncService = new ObjectSyncService(db, config, registrationService, scenario, options.embeddings);
  const queryService = new QueryService(db, config, scenario, options.embeddings);
  const resolveService = new ResolveService(db, config, scenario);

  return {
    registrations: registrationService,
    objects: objectSyncService,
    query: queryService,
    resolve: resolveService,
  };
}
