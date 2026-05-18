import { describe, expect, test } from 'bun:test';
import {
  catalogHealthResponseSchema,
  catalogManifestSchema,
  catalogQueryResultSchema,
  resolvableReferenceSchema,
} from '@ocp-catalog/ocp-schema';
import { AlimamaClient } from '../src/alimama/client';
import { createAlimamaCatalogApp } from '../src/app';
import type { AlimamaConfig } from '../src/config';
import { CommissionLedger } from '../src/services/commission-ledger';

const cfg: AlimamaConfig = {
  ALIMAMA_CATALOG_ID: 'cat_alimama_test',
  ALIMAMA_CATALOG_NAME: 'Alimama Test Catalog',
  ALIMAMA_CATALOG_PUBLIC_BASE_URL: 'http://localhost:4310',
  ALIMAMA_CATALOG_ADMIN_KEY: 'dev-admin-key',
  ALIMAMA_CATALOG_PORT: 4310,
  ALIMAMA_MOCK: true,
  ALIMAMA_ADZONE_ID: 'mock_adzone_001',
  ALIMAMA_BASE_URL: 'https://gw.api.taobao.com/router/rest',
  ALIMAMA_QUERY_TIMEOUT_MS: 5000,
  ALIMAMA_DEFAULT_PAGE_SIZE: 20,
  ALIMAMA_ORDER_POLL_INTERVAL_SEC: 0,
};

function app() {
  return createAlimamaCatalogApp({
    alimama: new AlimamaClient(cfg),
    ledger: new CommissionLedger(),
    cfg,
  });
}

async function json(res: Response) {
  expect(res.status).toBe(200);
  return res.json();
}

describe('Alimama Catalog Node routes', () => {
  test('well-known discovery points to Catalog endpoints', async () => {
    const body = await json(await app().handle(new Request('http://localhost/.well-known/ocp-catalog')));
    expect(body.kind).toBe('WellKnownCatalogDiscovery');
    expect(body.catalog_id).toBe('cat_alimama_test');
    expect(body.query_url).toBe('http://localhost:4310/ocp/query');
    expect(body.resolve_url).toBe('http://localhost:4310/ocp/resolve');
  });

  test('manifest is valid and has no Provider ingestion endpoints', async () => {
    const body = await json(await app().handle(new Request('http://localhost/ocp/manifest')));
    const parsed = catalogManifestSchema.parse(body);
    expect(parsed.endpoints.query.url).toBe('http://localhost:4310/ocp/query');
    expect(parsed.endpoints.resolve.url).toBe('http://localhost:4310/ocp/resolve');
    expect(parsed.endpoints.provider_registration).toBeUndefined();
    expect(parsed.endpoints.object_sync).toBeUndefined();
    expect(parsed.provider_contract).toBeUndefined();
    expect(parsed.query_capabilities[0]!.metadata.realtime).toBe(true);
  });

  test('health contract is valid', async () => {
    const body = await json(await app().handle(new Request('http://localhost/ocp/health')));
    const parsed = catalogHealthResponseSchema.parse(body);
    expect(parsed.ready).toBe(true);
    expect(parsed.details.persistent_product_storage).toBe(false);
  });

  test('query returns real-time affiliate Catalog entries', async () => {
    const res = await app().handle(new Request('http://localhost/ocp/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'CatalogQueryRequest',
        query: 'coffee',
        limit: 3,
        filters: { has_image: true },
      }),
    }));
    const body = catalogQueryResultSchema.parse(await json(res));
    expect(body.kind).toBe('CatalogQueryResult');
    expect(body.items).toHaveLength(3);
    expect(body.items[0]!.entry_id).toMatch(/^entry_alimama_taobao_union_/);
    expect(body.items[0]!.provider_id).toBe('alimama_taobao_union');
    expect(body.items[0]!.attributes.source_id).toBe('alimama_taobao_union');
  });

  test('resolve returns OCP ActionBindings instead of hook links', async () => {
    const res = await app().handle(new Request('http://localhost/ocp/resolve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'ResolveRequest',
        entry_id: 'entry_alimama_taobao_union_700123456001',
        purpose: 'checkout',
      }),
    }));
    const body = resolvableReferenceSchema.parse(await json(res));
    expect(body.kind).toBe('ResolvableReference');
    expect(body.object_id).toBe('700123456001');
    expect(body.provider_id).toBe('alimama_taobao_union');
    expect(body.action_bindings.length).toBeGreaterThan(0);
    expect(body.action_bindings[0]!.action_type).toBe('url');
    expect(body.action_bindings[0]!.entrypoint.url).toContain('s.click.taobao.com');
  });
});
