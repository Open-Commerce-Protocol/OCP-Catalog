import { cors } from '@elysiajs/cors';
import { Elysia } from 'elysia';
import { ZodError } from 'zod';
import type { PddClient } from './pdd/client';
import type { PddConfig } from './config';
import { PddCatalogQueryService } from './catalog/query';
import { PddCatalogResolveService } from './catalog/resolve';
import {
  buildCatalogHealth,
  buildCatalogManifest,
  buildWellKnownDiscovery,
} from './catalog/manifest';
import { createAdminRoutes } from './http/admin';
import type { CommissionLedger } from './services/commission-ledger';

export interface PddCatalogAppDeps {
  pdd: PddClient;
  ledger: CommissionLedger;
  cfg: PddConfig;
}

export function createPddCatalogApp(deps: PddCatalogAppDeps) {
  const queryService = new PddCatalogQueryService(deps.pdd, deps.cfg);
  const resolveService = new PddCatalogResolveService(deps.pdd, deps.cfg);

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
      service: 'pdd-catalog-api',
      catalog_id: deps.cfg.PDD_CATALOG_ID,
      mock_mode: deps.cfg.PDD_MOCK,
      custom_params_mode: deps.cfg.PDD_CUSTOM_PARAMS_MODE,
    }))
    .get('/.well-known/ocp-catalog', () => buildWellKnownDiscovery(deps.cfg))
    .get('/ocp/manifest', () => buildCatalogManifest(deps.cfg))
    .get('/ocp/health', () => buildCatalogHealth(deps.cfg))
    .get('/ocp/contracts', () => ({
      ocp_version: '1.0',
      kind: 'ObjectContractList',
      catalog_id: deps.cfg.PDD_CATALOG_ID,
      object_contracts: [],
      note: 'This Catalog Node is a real-time affiliate directory and does not accept provider object ingestion.',
    }))
    .post('/ocp/query', ({ body }) => queryService.query(body))
    .post('/ocp/resolve', ({ body }) => resolveService.resolve(body))
    .use(createAdminRoutes(deps));
}
