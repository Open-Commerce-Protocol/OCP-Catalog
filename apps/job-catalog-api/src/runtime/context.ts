import { createActivityDb } from '@ocp-catalog/activity-db';
import { createCatalogServices } from '@ocp-catalog/catalog-core';
import { createCatalogDb } from '@ocp-catalog/catalog-db';
import { ActivityEventService } from '@ocp-catalog/ocp-activity-core';
import { createJobCatalogScenario } from '../job-scenario';
import { loadJobCatalogConfig, toCatalogCoreConfig } from '../config';
import { JobQueryService } from '../query/job-query-service';

export type JobCatalogRuntimeContextOptions = {
  databasePoolMax?: number;
};

export function createJobCatalogRuntimeContext(options: JobCatalogRuntimeContextOptions = {}) {
  const config = loadJobCatalogConfig();
  const db = createCatalogDb(config.DATABASE_URL, {
    maxConnections: options.databasePoolMax ?? config.DATABASE_POOL_MAX,
  });
  const activityDb = createActivityDb(config.DATABASE_URL, {
    maxConnections: options.databasePoolMax ?? config.DATABASE_POOL_MAX,
  });
  const activityEvents = new ActivityEventService(activityDb);
  const jobCatalogScenario = createJobCatalogScenario({
    semanticQueryEnabled: config.JOB_CATALOG_SEMANTIC_QUERY_ENABLED,
  });
  const services = createCatalogServices(db, toCatalogCoreConfig(config) as any, jobCatalogScenario);
  const jobQueryService = new JobQueryService(db, config);

  return {
    config,
    db,
    activityEvents,
    jobCatalogScenario,
    services,
    jobQueryService,
  };
}

export type JobCatalogRuntimeContext = ReturnType<typeof createJobCatalogRuntimeContext>;
