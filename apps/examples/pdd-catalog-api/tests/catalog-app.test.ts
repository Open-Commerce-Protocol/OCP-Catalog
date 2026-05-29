import { describe, expect, test } from 'bun:test';
import {
  catalogHealthResponseSchema,
  catalogManifestSchema,
  catalogQueryResultSchema,
  resolvableReferenceSchema,
} from '@ocp-catalog/ocp-schema';
import { PddClient } from '../src/pdd/client';
import { createPddCatalogApp } from '../src/app';
import type { PddConfig } from '../src/config';
import { CommissionLedger } from '../src/services/commission-ledger';

const baseCfg: PddConfig = {
  PDD_CATALOG_ID: 'cat_pdd_test',
  PDD_CATALOG_NAME: 'PDD Test Catalog',
  PDD_CATALOG_PUBLIC_BASE_URL: 'http://localhost:4330',
  PDD_CATALOG_ADMIN_KEY: 'dev-admin-key',
  PDD_CATALOG_PORT: 4330,
  PDD_MOCK: true,
  PDD_PID: 'mock_pid_001',
  PDD_BASE_URL: 'https://gw-api.pinduoduo.com/api/router',
  PDD_QUERY_TIMEOUT_MS: 5000,
  PDD_DEFAULT_PAGE_SIZE: 20,
  PDD_ORDER_POLL_INTERVAL_SEC: 0,
  PDD_CUSTOM_PARAMS_MODE: 'enabled',
};

function appWith(cfg: PddConfig = baseCfg) {
  return createPddCatalogApp({
    pdd: new PddClient(cfg),
    ledger: new CommissionLedger(),
    cfg,
  });
}

async function json(res: Response) {
  expect(res.status).toBe(200);
  return res.json();
}

describe('PDD Duoduojinbao Catalog Node routes', () => {
  test('well-known discovery 指向 Catalog 端点', async () => {
    const body = await json(
      await appWith().handle(new Request('http://localhost/.well-known/ocp-catalog')),
    );
    expect(body.kind).toBe('WellKnownCatalogDiscovery');
    expect(body.catalog_id).toBe('cat_pdd_test');
    expect(body.query_url).toBe('http://localhost:4330/ocp/query');
    expect(body.resolve_url).toBe('http://localhost:4330/ocp/resolve');
  });

  test('manifest 合法且不声明 Provider ingestion 端点', async () => {
    const body = await json(await appWith().handle(new Request('http://localhost/ocp/manifest')));
    const parsed = catalogManifestSchema.parse(body);
    expect(parsed.endpoints.query.url).toBe('http://localhost:4330/ocp/query');
    expect(parsed.endpoints.resolve.url).toBe('http://localhost:4330/ocp/resolve');
    expect(parsed.endpoints.provider_registration).toBeUndefined();
    expect(parsed.endpoints.object_sync).toBeUndefined();
    expect(parsed.provider_contract).toBeUndefined();
    expect(parsed.query_capabilities[0]!.metadata.realtime).toBe(true);
    expect(parsed.query_capabilities[0]!.metadata.source_id).toBe('pdd');
  });

  test('manifest 暴露 pdd_merchant_type 作为可 filter 字段', async () => {
    const body = await json(await appWith().handle(new Request('http://localhost/ocp/manifest')));
    const filterRefs = body.query_capabilities[0]!.filterable_field_refs;
    expect(filterRefs).toContain('affiliate.product#/pdd_merchant_type');
  });

  test('health 合法,暴露 custom_params_mode', async () => {
    const body = await json(await appWith().handle(new Request('http://localhost/ocp/health')));
    const parsed = catalogHealthResponseSchema.parse(body);
    expect(parsed.ready).toBe(true);
    expect(parsed.details.persistent_product_storage).toBe(false);
    expect(parsed.details.custom_params_mode).toBe('enabled');
  });

  test('contracts 返空但带 note', async () => {
    const body = await json(await appWith().handle(new Request('http://localhost/ocp/contracts')));
    expect(body.kind).toBe('ObjectContractList');
    expect(body.object_contracts).toEqual([]);
    expect(body.note).toContain('does not accept provider object ingestion');
  });

  test('query 返回 entry_id 带 pdd 前缀的 Catalog entries', async () => {
    const res = await appWith().handle(
      new Request('http://localhost/ocp/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'CatalogQueryRequest',
          query: '耳机',
          limit: 3,
          filters: {},
        }),
      }),
    );
    const body = catalogQueryResultSchema.parse(await json(res));
    expect(body.items.length).toBe(3);
    expect(body.items[0]!.entry_id).toMatch(/^entry_pdd_/);
    expect(body.items[0]!.provider_id).toBe('pdd');
    expect((body.items[0]!.attributes as any).source_id).toBe('pdd');
    expect((body.items[0]!.attributes as any).platform).toBe('pdd');
  });

  test('query 价格已经转成元 number (不是分)', async () => {
    const res = await appWith().handle(
      new Request('http://localhost/ocp/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'CatalogQueryRequest',
          query: '',
          limit: 1,
          filters: {},
        }),
      }),
    );
    const body = catalogQueryResultSchema.parse(await json(res));
    const price = (body.items[0]!.attributes as any).price;
    // 索尼耳机 fixture: min_group_price=249900 fen → amount=2499 yuan
    expect(price.amount).toBe(2499);
    expect(price.list_amount).toBe(2799);
  });

  test('resolve 返回 p.pinduoduo.com 短链 + 含 customParameters 标记', async () => {
    const res = await appWith().handle(
      new Request('http://localhost/ocp/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'ResolveRequest',
          entry_id: 'entry_pdd_250012345678',
          purpose: 'checkout',
        }),
      }),
    );
    const body = resolvableReferenceSchema.parse(await json(res));
    expect(body.kind).toBe('ResolvableReference');
    expect(body.object_id).toBe('250012345678');
    expect(body.provider_id).toBe('pdd');
    expect(body.action_bindings.length).toBeGreaterThan(0);
    expect(body.action_bindings[0]!.entrypoint.url).toContain('p.pinduoduo.com');
    expect((body.visible_attributes as any).custom_params_mode).toBe('enabled');
    expect((body.visible_attributes as any).pid).toBe('mock_pid_001');
    expect(body.live_checks[0]!.check_id).toBe('pdd_promotion_url_generate');
    expect(body.live_checks[0]!.status).toBe('passed');
  });

  test('resolve 不同 entry_id 通过 customParameters 透传产生不同短链', async () => {
    const app = appWith();
    const r1 = await app.handle(
      new Request('http://localhost/ocp/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'ResolveRequest',
          entry_id: 'entry_pdd_250012345678',
        }),
      }),
    );
    const r2 = await app.handle(
      new Request('http://localhost/ocp/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'ResolveRequest',
          entry_id: 'entry_pdd_250023456789',
        }),
      }),
    );
    const b1 = resolvableReferenceSchema.parse(await json(r1));
    const b2 = resolvableReferenceSchema.parse(await json(r2));
    expect(b1.action_bindings[0]!.entrypoint.url).not.toEqual(
      b2.action_bindings[0]!.entrypoint.url,
    );
  });

  test('resolve(custom_params_mode=disabled) 不透传 customParameters', async () => {
    const cfg: PddConfig = { ...baseCfg, PDD_CUSTOM_PARAMS_MODE: 'disabled' };
    const res = await appWith(cfg).handle(
      new Request('http://localhost/ocp/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'ResolveRequest',
          entry_id: 'entry_pdd_250012345678',
        }),
      }),
    );
    const body = resolvableReferenceSchema.parse(await json(res));
    expect((body.visible_attributes as any).custom_params_mode).toBe('disabled');
    // 仍然能拿到 affiliate URL,只是 customParameters 不透传
    expect(body.action_bindings.length).toBeGreaterThan(0);
  });

  test('resolve TTL = 15 分钟', async () => {
    const res = await appWith().handle(
      new Request('http://localhost/ocp/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'ResolveRequest',
          entry_id: 'entry_pdd_250023456789',
        }),
      }),
    );
    const body = resolvableReferenceSchema.parse(await json(res));
    const ttlMs =
      new Date(body.expires_at).getTime() - new Date(body.freshness.resolved_at).getTime();
    expect(ttlMs).toBe(15 * 60 * 1000);
  });

  test('query 体非法 → 400 + validation_error', async () => {
    const res = await appWith().handle(
      new Request('http://localhost/ocp/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ limit: -5 }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('validation_error');
  });
});
