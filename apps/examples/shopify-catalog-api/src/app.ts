import { cors } from '@elysiajs/cors';
import { Elysia } from 'elysia';
import { AppError } from '@ocp-catalog/shared';
import { ZodError } from 'zod';
import type { ShopifyConfig } from './config';
import {
  buildCatalogHealth,
  buildCatalogManifest,
  buildContracts,
  buildWellKnownDiscovery,
} from './catalog/manifest';
import { ShopifyCatalogQueryService } from './catalog/query-service';
import { ShopifyCatalogResolveService } from './catalog/resolve-service';
import { createAdminRoutes } from './http/admin';
import { ShopifyApiError, type ShopifyCatalogClient } from './shopify/mcp-client';

export interface ShopifyCatalogAppDeps {
  shopify: ShopifyCatalogClient;
  cfg: ShopifyConfig;
}

export function createShopifyCatalogApp(deps: ShopifyCatalogAppDeps) {
  const queryService = new ShopifyCatalogQueryService(deps.shopify, deps.cfg);
  const resolveService = new ShopifyCatalogResolveService(deps.shopify, deps.cfg);

  return new Elysia()
    .use(cors())
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
      if (error instanceof ShopifyApiError) {
        set.status = 502;
        return {
          error: {
            code: error.code,
            message: error.message,
          },
        };
      }
      if (error instanceof AppError) {
        set.status = error.status;
        return {
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
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
      service: 'shopify-catalog-api',
      catalog_id: deps.cfg.SHOPIFY_CATALOG_ID,
      mock_mode: deps.cfg.SHOPIFY_MOCK,
      mode: deps.cfg.SHOPIFY_CATALOG_MODE,
    }))
    .get('/.well-known/ocp-catalog', () => buildWellKnownDiscovery(deps.cfg))
    .get('/ocp/manifest', () => buildCatalogManifest(deps.cfg))
    .get('/ocp/health', () => buildCatalogHealth(deps.cfg))
    .get('/ocp/contracts', () => buildContracts(deps.cfg))
    .post('/ocp/query', ({ body }) => queryService.query(body))
    .post('/ocp/resolve', ({ body }) => resolveService.resolve(body))
    .use(createAdminRoutes(deps));
}
