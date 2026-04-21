import { cors } from '@elysiajs/cors';
import { requireApiKey } from '@ocp-catalog/auth-core';
import { loadConfig } from '@ocp-catalog/config';
import { createDb } from '@ocp-catalog/db';
import { AppError, createSpaStaticSiteHandler } from '@ocp-catalog/shared';
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
const providerAdminSite = createSpaStaticSiteHandler(new URL('../public/provider-admin', import.meta.url).pathname);

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
  .get('/api/provider-admin/admin/products', async ({ headers }) => {
    assertAdminAuth(headers);
    return { provider_id: config.COMMERCE_PROVIDER_ID, products: await products.listProducts() };
  })
  .post('/admin/products', async ({ body, headers }) => {
    assertAdminAuth(headers);
    return products.createProduct(productCreateSchema.parse(body));
  })
  .post('/api/provider-admin/admin/products', async ({ body, headers }) => {
    assertAdminAuth(headers);
    return products.createProduct(productCreateSchema.parse(body));
  })
  .post('/admin/products/seed-demo', async ({ headers }) => {
    assertAdminAuth(headers);
    const seeded = await products.seedDemoProducts(demoProducts());
    return { provider_id: config.COMMERCE_PROVIDER_ID, seeded_count: seeded.length, products: seeded };
  })
  .post('/api/provider-admin/admin/products/seed-demo', async ({ headers }) => {
    assertAdminAuth(headers);
    const seeded = await products.seedDemoProducts(demoProducts());
    return { provider_id: config.COMMERCE_PROVIDER_ID, seeded_count: seeded.length, products: seeded };
  })
  .get('/admin/products/:id', async ({ params, headers }) => {
    assertAdminAuth(headers);
    return products.getProduct(params.id);
  })
  .get('/api/provider-admin/admin/products/:id', async ({ params, headers }) => {
    assertAdminAuth(headers);
    return products.getProduct(params.id);
  })
  .patch('/admin/products/:id', async ({ params, body, headers }) => {
    assertAdminAuth(headers);
    return products.updateProduct(params.id, productPatchSchema.parse(body));
  })
  .patch('/api/provider-admin/admin/products/:id', async ({ params, body, headers }) => {
    assertAdminAuth(headers);
    return products.updateProduct(params.id, productPatchSchema.parse(body));
  })
  .delete('/admin/products/:id', async ({ params, headers }) => {
    assertAdminAuth(headers);
    return products.deactivateProduct(params.id);
  })
  .delete('/api/provider-admin/admin/products/:id', async ({ params, headers }) => {
    assertAdminAuth(headers);
    return products.deactivateProduct(params.id);
  })
  .post('/provider/register-to-catalog', async ({ body, headers }) => {
    assertAdminAuth(headers);
    const request = syncRequestSchema.parse(body ?? {});
    return provider.registerToCatalog(request.registration_version);
  })
  .post('/api/provider-admin/provider/register-to-catalog', async ({ body, headers }) => {
    assertAdminAuth(headers);
    const request = syncRequestSchema.parse(body ?? {});
    return provider.registerToCatalog(request.registration_version);
  })
  .post('/provider/publish-to-catalog', async ({ body, headers }) => {
    assertAdminAuth(headers);
    const request = syncRequestSchema.parse(body ?? {});
    return provider.publishToCatalog(request.registration_version);
  })
  .post('/api/provider-admin/provider/publish-to-catalog', async ({ body, headers }) => {
    assertAdminAuth(headers);
    const request = syncRequestSchema.parse(body ?? {});
    return provider.publishToCatalog(request.registration_version);
  })
  .post('/provider/sync-to-catalog', async ({ body, headers }) => {
    assertAdminAuth(headers);
    const request = syncRequestSchema.parse(body ?? {});
    return provider.syncAll(request.registration_version);
  })
  .post('/api/provider-admin/provider/sync-to-catalog', async ({ body, headers }) => {
    assertAdminAuth(headers);
    const request = syncRequestSchema.parse(body ?? {});
    return provider.syncAll(request.registration_version);
  })
  .post('/provider/sync-product/:id', async ({ params, body, headers }) => {
    assertAdminAuth(headers);
    const request = syncRequestSchema.parse(body ?? {});
    return provider.syncOne(params.id, request.registration_version);
  })
  .post('/api/provider-admin/provider/sync-product/:id', async ({ params, body, headers }) => {
    assertAdminAuth(headers);
    const request = syncRequestSchema.parse(body ?? {});
    return provider.syncOne(params.id, request.registration_version);
  })
  .get('/provider/sync-runs', async ({ headers }) => {
    assertAdminAuth(headers);
    return { provider_id: config.COMMERCE_PROVIDER_ID, runs: await provider.listSyncRuns() };
  })
  .get('/api/provider-admin/provider/sync-runs', async ({ headers }) => {
    assertAdminAuth(headers);
    return { provider_id: config.COMMERCE_PROVIDER_ID, runs: await provider.listSyncRuns() };
  })
  .get('/provider/status', async ({ headers }) => {
    assertAdminAuth(headers);
    return provider.getCatalogStatus();
  })
  .get('/api/provider-admin/provider/status', async ({ headers }) => {
    assertAdminAuth(headers);
    return provider.getCatalogStatus();
  })
  .get('/', () => serveProviderAdmin('/'))
  .get('/*', async ({ request }) => {
    const pathname = new URL(request.url).pathname;
    if (
      pathname === '/health'
      || pathname.startsWith('/admin/')
      || pathname.startsWith('/provider/')
      || pathname.startsWith('/api/provider-admin/')
    ) {
      return new Response('Not Found', { status: 404 });
    }

    return serveProviderAdmin(pathname);
  })
  .listen(config.PROVIDER_API_PORT);

console.log(`Commerce Provider API listening on http://localhost:${app.server?.port}`);
if (await providerAdminSite('/')) {
  console.log(`Commerce Provider Admin static site mounted from apps/commerce-provider-api/public/provider-admin`);
}

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

async function serveProviderAdmin(pathname: string) {
  const response = await providerAdminSite(pathname);
  return response ?? new Response('Not Found', { status: 404 });
}
