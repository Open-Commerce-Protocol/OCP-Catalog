import { cors } from '@elysiajs/cors';
import { Elysia } from 'elysia';
import { ZodError } from 'zod';
import type { AlimamaClient } from './alimama/client';
import type { AlimamaConfig } from './config';
import { AffiliateCatalogQueryService } from './catalog/query';
import { AffiliateCatalogResolveService } from './catalog/resolve';
import { buildCatalogHealth, buildCatalogManifest, buildWellKnownDiscovery } from './catalog/manifest';
import { MaterialResolveCache } from './catalog/material-cache';
import { createAdminRoutes } from './http/admin';
import type { CommissionLedger } from './services/commission-ledger';

export interface AlimamaCatalogAppDeps {
  alimama: AlimamaClient;
  ledger: CommissionLedger;
  cfg: AlimamaConfig;
}

export function createAlimamaCatalogApp(deps: AlimamaCatalogAppDeps) {
  const resolveCache = new MaterialResolveCache();
  const queryService = new AffiliateCatalogQueryService(deps.alimama, deps.cfg, resolveCache);
  const resolveService = new AffiliateCatalogResolveService(deps.alimama, deps.cfg, resolveCache);

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
      service: 'alimama-catalog-api',
      catalog_id: deps.cfg.ALIMAMA_CATALOG_ID,
      mock_mode: deps.cfg.ALIMAMA_MOCK,
    }))
    .get('/.well-known/ocp-catalog', () => buildWellKnownDiscovery(deps.cfg))
    .get('/ocp/manifest', () => buildCatalogManifest(deps.cfg))
    .get('/ocp/health', () => buildCatalogHealth(deps.cfg))
    .get('/ocp/contracts', () => ({
      ocp_version: '1.0',
      kind: 'ObjectContractList',
      catalog_id: deps.cfg.ALIMAMA_CATALOG_ID,
      object_contracts: [],
      note: 'This Catalog Node is a real-time affiliate directory and does not accept provider object ingestion.',
    }))
    .post('/ocp/query', ({ body }) => queryService.query(body))
    .post('/ocp/resolve', ({ body }) => resolveService.resolve(body))
    .use(createAdminRoutes(deps));
}
