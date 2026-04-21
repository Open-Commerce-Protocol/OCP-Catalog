import { cors } from '@elysiajs/cors';
import { requireApiKey } from '@ocp-catalog/auth-core';
import { loadConfig } from '@ocp-catalog/config';
import { createDb } from '@ocp-catalog/db';
import { AppError } from '@ocp-catalog/shared';
import { Elysia } from 'elysia';
import { ZodError } from 'zod';
import { CatalogClient } from './catalog-client';
import { demoProducts } from './demo-products';
import { productCreateSchema, productPatchSchema, syncRequestSchema } from './product-schema';
import { ProductRepository } from './product-repository';
import { ProviderService } from './provider-service';

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
const products = new ProductRepository(db, config);
const provider = new ProviderService(db, config, products, new CatalogClient(config));

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
    service: 'commerce-provider-api',
    provider_id: config.COMMERCE_PROVIDER_ID,
  }))
  .get('/admin/products', async ({ headers }) => {
    assertAdminAuth(headers);
    return { provider_id: config.COMMERCE_PROVIDER_ID, products: await products.listProducts() };
  })
  .post('/admin/products', async ({ body, headers }) => {
    assertAdminAuth(headers);
    return products.createProduct(productCreateSchema.parse(body));
  })
  .post('/admin/products/seed-demo', async ({ headers }) => {
    assertAdminAuth(headers);
    const seeded = await products.seedDemoProducts(demoProducts());
    return { provider_id: config.COMMERCE_PROVIDER_ID, seeded_count: seeded.length, products: seeded };
  })
  .get('/admin/products/:id', async ({ params, headers }) => {
    assertAdminAuth(headers);
    return products.getProduct(params.id);
  })
  .patch('/admin/products/:id', async ({ params, body, headers }) => {
    assertAdminAuth(headers);
    return products.updateProduct(params.id, productPatchSchema.parse(body));
  })
  .delete('/admin/products/:id', async ({ params, headers }) => {
    assertAdminAuth(headers);
    return products.deactivateProduct(params.id);
  })
  .post('/provider/register-to-catalog', async ({ body, headers }) => {
    assertAdminAuth(headers);
    const request = syncRequestSchema.parse(body ?? {});
    return provider.registerToCatalog(request.registration_version);
  })
  .post('/provider/publish-to-catalog', async ({ body, headers }) => {
    assertAdminAuth(headers);
    const request = syncRequestSchema.parse(body ?? {});
    return provider.publishToCatalog(request.registration_version);
  })
  .post('/provider/sync-to-catalog', async ({ body, headers }) => {
    assertAdminAuth(headers);
    const request = syncRequestSchema.parse(body ?? {});
    return provider.syncAll(request.registration_version);
  })
  .post('/provider/sync-product/:id', async ({ params, body, headers }) => {
    assertAdminAuth(headers);
    const request = syncRequestSchema.parse(body ?? {});
    return provider.syncOne(params.id, request.registration_version);
  })
  .get('/provider/sync-runs', async ({ headers }) => {
    assertAdminAuth(headers);
    return { provider_id: config.COMMERCE_PROVIDER_ID, runs: await provider.listSyncRuns() };
  })
  .get('/provider/status', async ({ headers }) => {
    assertAdminAuth(headers);
    return provider.getCatalogStatus();
  })
  .listen(config.PROVIDER_API_PORT);

console.log(`Commerce Provider API listening on http://localhost:${app.server?.port}`);

function assertAdminAuth(headers: Record<string, string | undefined>) {
  requireApiKey(
    firstHeader(headers['x-admin-key']) ?? firstHeader(headers['x-api-key']),
    config.API_KEY_DEV,
    config.API_KEYS,
  );
}

function firstHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
