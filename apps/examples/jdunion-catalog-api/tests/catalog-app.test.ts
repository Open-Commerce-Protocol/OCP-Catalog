import { describe, expect, test } from 'bun:test';
import {
  catalogHealthResponseSchema,
  catalogManifestSchema,
  catalogQueryResultSchema,
  resolvableReferenceSchema,
} from '@ocp-catalog/ocp-schema';
import { JdUnionClient } from '../src/jd/client';
import { createJdUnionCatalogApp } from '../src/app';
import type { JdUnionConfig } from '../src/config';
import { CommissionLedger } from '../src/services/commission-ledger';

const baseCfg: JdUnionConfig = {
  JDUNION_CATALOG_ID: 'cat_jdunion_test',
  JDUNION_CATALOG_NAME: 'JD Union Test Catalog',
  JDUNION_CATALOG_PUBLIC_BASE_URL: 'http://localhost:4320',
  JDUNION_CATALOG_ADMIN_KEY: 'dev-admin-key',
  JDUNION_CATALOG_PORT: 4320,
  JDUNION_MOCK: true,
  JDUNION_POSITION_ID: 'mock_position_001',
  JDUNION_BASE_URL: 'https://router.jd.com/api',
  JDUNION_QUERY_TIMEOUT_MS: 5000,
  JDUNION_DEFAULT_PAGE_SIZE: 20,
  JDUNION_ORDER_POLL_INTERVAL_SEC: 0,
  JDUNION_RESOLVE_STRATEGY: 'goods_promotion',
};

function appWith(cfg: JdUnionConfig = baseCfg) {
  return createJdUnionCatalogApp({
    jd: new JdUnionClient(cfg),
    ledger: new CommissionLedger(),
    cfg,
  });
}

async function json(res: Response) {
  expect(res.status).toBe(200);
  return res.json();
}

describe('JD Union Catalog Node routes', () => {
  test('well-known discovery 指向 Catalog 端点', async () => {
    const body = await json(
      await appWith().handle(new Request('http://localhost/.well-known/ocp-catalog')),
    );
    expect(body.kind).toBe('WellKnownCatalogDiscovery');
    expect(body.catalog_id).toBe('cat_jdunion_test');
    expect(body.query_url).toBe('http://localhost:4320/ocp/query');
    expect(body.resolve_url).toBe('http://localhost:4320/ocp/resolve');
  });

  test('manifest 合法且不声明 Provider ingestion 端点', async () => {
    const body = await json(await appWith().handle(new Request('http://localhost/ocp/manifest')));
    const parsed = catalogManifestSchema.parse(body);
    expect(parsed.endpoints.query.url).toBe('http://localhost:4320/ocp/query');
    expect(parsed.endpoints.resolve.url).toBe('http://localhost:4320/ocp/resolve');
    expect(parsed.endpoints.provider_registration).toBeUndefined();
    expect(parsed.endpoints.object_sync).toBeUndefined();
    expect(parsed.provider_contract).toBeUndefined();
    expect(parsed.query_capabilities[0]!.metadata.realtime).toBe(true);
    expect(parsed.query_capabilities[0]!.metadata.source_id).toBe('jdunion');
  });

  test('health 合法', async () => {
    const body = await json(await appWith().handle(new Request('http://localhost/ocp/health')));
    const parsed = catalogHealthResponseSchema.parse(body);
    expect(parsed.ready).toBe(true);
    expect(parsed.details.persistent_product_storage).toBe(false);
    expect(parsed.details.resolve_strategy).toBe('goods_promotion');
  });

  test('contracts 返空但带 note', async () => {
    const body = await json(await appWith().handle(new Request('http://localhost/ocp/contracts')));
    expect(body.kind).toBe('ObjectContractList');
    expect(body.object_contracts).toEqual([]);
    expect(body.note).toContain('does not accept provider object ingestion');
  });

  test('query 返回 entry_id 带 jdunion 前缀的 Catalog entries', async () => {
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
    expect(body.items[0]!.entry_id).toMatch(/^entry_jdunion_/);
    expect(body.items[0]!.provider_id).toBe('jdunion');
    expect((body.items[0]!.attributes as any).source_id).toBe('jdunion');
    expect((body.items[0]!.attributes as any).platform).toBe('jd');
  });

  test('resolve(strategy=goods_promotion) 返回 u.jd.com 短链', async () => {
    const res = await appWith().handle(
      new Request('http://localhost/ocp/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'ResolveRequest',
          entry_id: 'entry_jdunion_100012345678',
          purpose: 'checkout',
        }),
      }),
    );
    const body = resolvableReferenceSchema.parse(await json(res));
    expect(body.kind).toBe('ResolvableReference');
    expect(body.object_id).toBe('100012345678');
    expect(body.provider_id).toBe('jdunion');
    expect(body.action_bindings.length).toBeGreaterThan(0);
    expect(body.action_bindings[0]!.entrypoint.url).toContain('u.jd.com');
    expect((body.visible_attributes as any).resolve_strategy).toBe('goods_promotion');
    expect(body.live_checks[0]!.check_id).toBe('jdunion_goods_lookup');
    expect(body.live_checks[0]!.status).toBe('passed');
  });

  test('resolve(strategy=promotion_common) 走 promotion.common.get 分支', async () => {
    const cfg: JdUnionConfig = { ...baseCfg, JDUNION_RESOLVE_STRATEGY: 'promotion_common' };
    const res = await appWith(cfg).handle(
      new Request('http://localhost/ocp/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'ResolveRequest',
          entry_id: 'entry_jdunion_100012345678',
          purpose: 'checkout',
        }),
      }),
    );
    const body = resolvableReferenceSchema.parse(await json(res));
    expect(body.action_bindings.length).toBe(1);
    expect(body.action_bindings[0]!.entrypoint.url).toContain('u.jd.com');
    expect((body.visible_attributes as any).resolve_strategy).toBe('promotion_common');
    expect(body.live_checks[0]!.check_id).toBe('jdunion_promotion_link_mint');
  });

  test('resolve TTL = 15 分钟', async () => {
    const res = await appWith().handle(
      new Request('http://localhost/ocp/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'ResolveRequest',
          entry_id: 'entry_jdunion_100023456789',
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
