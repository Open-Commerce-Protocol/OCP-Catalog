import { cors } from '@elysiajs/cors';
import { buildCenterDiscovery, buildCenterManifest, createCenterServices, startCatalogRefreshScheduler } from '@ocp-catalog/center-core';
import { loadConfig } from '@ocp-catalog/config';
import { createDb } from '@ocp-catalog/db';
import { AppError } from '@ocp-catalog/shared';
import { Elysia } from 'elysia';
import { ZodError } from 'zod';

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
const services = createCenterServices(db, config);
const refreshScheduler = startCatalogRefreshScheduler(services.catalogs, config);

const app = new Elysia()
  .use(cors())
  .onError(({ error, set }) => {
    if (error instanceof AppError) {
      set.status = error.status;
      return { error: { code: error.code, message: error.message, details: error.details } };
    }

    if (error instanceof ZodError) {
      set.status = 400;
      return { error: { code: 'validation_error', message: 'Invalid request body', details: error.issues } };
    }

    set.status = 500;
    return {
      error: {
        code: 'internal_error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  })
  .get('/health', () => ({
    ok: true,
    service: 'ocp-center-api',
    protocol: 'ocp.catalog.center.v1',
  }))
  .get('/.well-known/ocp-center', () => buildCenterDiscovery(config))
  .get('/ocp/center/manifest', () => buildCenterManifest(config))
  .post('/ocp/catalogs/register', async ({ body, headers }) => services.catalogs.register(body, {
    sourceIp: firstHeader(headers['x-forwarded-for']) ?? firstHeader(headers['x-real-ip']),
    userAgent: firstHeader(headers['user-agent']),
  }))
  .get('/ocp/catalogs/:catalogId', async ({ params }) => services.catalogs.getCatalog(params.catalogId))
  .get('/ocp/catalogs/:catalogId/manifest-snapshot', async ({ params }) => services.catalogs.getManifestSnapshot(params.catalogId))
  .get('/ocp/catalogs/:catalogId/health', async ({ params }) => ({
    center_id: config.CENTER_ID,
    catalog_id: params.catalogId,
    checks: await services.catalogs.getHealth(params.catalogId),
  }))
  .get('/ocp/catalogs/:catalogId/verification', async ({ params }) => ({
    center_id: config.CENTER_ID,
    catalog_id: params.catalogId,
    records: await services.catalogs.listVerificationRecords(params.catalogId),
  }))
  .post('/ocp/catalogs/:catalogId/verify', async ({ params, body }) => services.catalogs.verify(params.catalogId, body ?? {}))
  .post('/ocp/catalogs/:catalogId/refresh', async ({ params, headers }) => services.catalogs.refresh(params.catalogId, {
    catalogToken: firstHeader(headers['x-catalog-token']),
  }))
  .post('/ocp/catalogs/:catalogId/token/rotate', async ({ params, headers }) => services.catalogs.rotateToken(params.catalogId, {
    catalogToken: firstHeader(headers['x-catalog-token']),
  }))
  .post('/ocp/catalogs/search', async ({ body, headers }) => services.catalogs.search(body, {
    requesterKey: firstHeader(headers['x-api-key']),
  }))
  .post('/ocp/catalogs/resolve', async ({ body }) => services.catalogs.resolve(body))
  .listen(config.CENTER_API_PORT);

console.log(`OCP Center API listening on http://localhost:${app.server?.port}`);
if (refreshScheduler) {
  console.log(`OCP Center refresh scheduler enabled every ${config.CENTER_REFRESH_INTERVAL_SECONDS}s`);
}

function firstHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
