import { cors } from '@elysiajs/cors';
import { Elysia } from 'elysia';
import { ZodError } from 'zod';
import type { JdUnionClient } from './jd/client';
import type { JdUnionConfig } from './config';
import { JdUnionCatalogQueryService } from './catalog/query';
import { JdUnionCatalogResolveService } from './catalog/resolve';
import {
  buildCatalogHealth,
  buildCatalogManifest,
  buildWellKnownDiscovery,
} from './catalog/manifest';
import { createAdminRoutes } from './http/admin';
import type { CommissionLedger } from './services/commission-ledger';

export interface JdUnionCatalogAppDeps {
  jd: JdUnionClient;
  ledger: CommissionLedger;
  cfg: JdUnionConfig;
}

export function createJdUnionCatalogApp(deps: JdUnionCatalogAppDeps) {
  const queryService = new JdUnionCatalogQueryService(deps.jd, deps.cfg);
  const resolveService = new JdUnionCatalogResolveService(deps.jd, deps.cfg);

  return new Elysia()
    .use(cors({ origin: false }))
    .onError(({ error, set }) => {
      if (error instanceof ZodError) {
        set.status = 400;
        return {
          error: {
            code: 'validation_error',
            message: 'Invalid request body',
            details: error.issues,
          },
        };
      }
      set.status = 500;
      return {
        error: {
          code: 'internal_error',
          message: error instanceof Error ? error.message : 'Internal server error',
        },
      };
    })
    .get('/health', () => ({
      ok: true,
      service: 'jdunion-catalog-api',
      catalog_id: deps.cfg.JDUNION_CATALOG_ID,
      mock_mode: deps.cfg.JDUNION_MOCK,
      resolve_strategy: deps.cfg.JDUNION_RESOLVE_STRATEGY,
    }))
    .get('/.well-known/ocp-catalog', () => buildWellKnownDiscovery(deps.cfg))
    .get('/ocp/manifest', () => buildCatalogManifest(deps.cfg))
    .get('/ocp/health', () => buildCatalogHealth(deps.cfg))
    .get('/ocp/contracts', () => ({
      ocp_version: '1.0',
      kind: 'ObjectContractList',
      catalog_id: deps.cfg.JDUNION_CATALOG_ID,
      object_contracts: [],
      note: 'This Catalog Node is a real-time affiliate directory and does not accept provider object ingestion.',
    }))
    .post('/ocp/query', ({ body }) => queryService.query(body))
    .post('/ocp/resolve', ({ body }) => resolveService.resolve(body))
    .use(createAdminRoutes(deps));
}
