import { cors } from '@elysiajs/cors';
import { requireApiKey } from '@ocp-catalog/auth-core';
import { buildCatalogManifest, buildWellKnownDiscovery, CatalogEmbeddingService, createCatalogServices } from '@ocp-catalog/catalog-core';
import { loadConfig } from '@ocp-catalog/config';
import { createDb } from '@ocp-catalog/db';
import { AppError } from '@ocp-catalog/shared';
import { Elysia } from 'elysia';
import { ZodError } from 'zod';
import { createCommerceCatalogScenario } from './commerce-scenario';
import { createCommerceEmbeddingProvider } from './embedding-provider';

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
const embeddingProvider = createCommerceEmbeddingProvider(config);
const commerceCatalogScenario = createCommerceCatalogScenario({
  semanticSearchEnabled: Boolean(embeddingProvider),
});
const embeddingService = embeddingProvider
  ? new CatalogEmbeddingService(db, commerceCatalogScenario, embeddingProvider)
  : undefined;
const services = createCatalogServices(db, config, commerceCatalogScenario, {
  embeddings: embeddingService,
});

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
    service: 'commerce-catalog-api',
    protocol: 'ocp.catalog.handshake.v1',
  }))
  .get('/.well-known/ocp-catalog', () => buildWellKnownDiscovery(config))
  .get('/ocp/manifest', () => buildCatalogManifest(config, commerceCatalogScenario))
  .get('/ocp/contracts', ({ query }) => {
    const contracts = buildCatalogManifest(config, commerceCatalogScenario).object_contracts;
    const objectType = typeof query.object_type === 'string' ? query.object_type : null;

    return {
      ocp_version: '1.0',
      kind: 'ObjectContractList',
      catalog_id: config.CATALOG_ID,
      contracts: objectType ? contracts.filter((contract) => contract.object_type === objectType) : contracts,
    };
  })
  .post('/ocp/providers/register', async ({ body, headers }) => {
    assertWriteAuth(headers);
    return services.registrations.register(body, {
      sourceIp: firstHeader(headers['x-forwarded-for']) ?? firstHeader(headers['x-real-ip']),
      userAgent: firstHeader(headers['user-agent']),
    });
  })
  .get('/ocp/providers/:providerId', async ({ params }) => services.registrations.getProvider(params.providerId))
  .get('/ocp/providers/:providerId/registrations', async ({ params }) => ({
    catalog_id: config.CATALOG_ID,
    provider_id: params.providerId,
    registrations: await services.registrations.listRegistrations(params.providerId),
  }))
  .post('/ocp/objects/sync', async ({ body, headers }) => {
    assertWriteAuth(headers);
    return services.objects.sync(body);
  })
  .get('/ocp/providers/:providerId/objects', async ({ params }) => ({
    catalog_id: config.CATALOG_ID,
    provider_id: params.providerId,
    objects: await services.objects.listProviderObjects(params.providerId),
  }))
  .get('/ocp/objects/:objectId', async ({ params }) => services.objects.getObject(params.objectId))
  .post('/ocp/query', async ({ body, headers }) => services.query.query(body, {
    requesterKey: firstHeader(headers['x-api-key']),
  }))
  .post('/ocp/resolve', async ({ body }) => services.resolve.resolve(body))
  .listen(config.CATALOG_API_PORT);

console.log(`Commerce Catalog API listening on http://localhost:${app.server?.port}`);

function assertWriteAuth(headers: Record<string, string | undefined>) {
  requireApiKey(firstHeader(headers['x-api-key']), config.API_KEY_DEV, config.API_KEYS);
}

function firstHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
