/**
 * resolve-hook 端点集成测试:不起 HTTP server,直接 .handle(Request) 走 Elysia 内部。
 *
 * 关键验证:
 *   - 正常路径:hook 调 alimama → 返 provider-owned affiliate links
 *   - alimama 抛 AlimamaApiError → 降级返空
 *   - alimama 抛意外错误 → 也降级返空
 *   - 入参校验:缺 entry_id 应被 Elysia/zod 拒绝
 */
import { describe, expect, test } from 'bun:test';
import { AlimamaApiError, type AlimamaClient } from '../src/alimama/client';
import type { AlimamaPrivilegeResponse } from '../src/alimama/types';
import type { AlimamaConfig } from '../src/config';
import { createResolveHookRoutes } from '../src/http/resolve-hook';

const baseCfg: AlimamaConfig = {
  OCP_CATALOG_BASE_URL: 'http://localhost:4000',
  OCP_CATALOG_ID: 'cat_local_dev',
  OCP_PROVIDER_ID: 'alimama_test',
  OCP_API_KEY: 'dev-api-key',
  OCP_PROVIDER_BASE_URL: 'http://localhost:4300',
  OCP_PROVIDER_ADMIN_KEY: 'dev-admin-key',
  OCP_PROVIDER_HOOK_SECRET: 'dev-hook-secret',
  PROVIDER_PORT: 4300,
  ALIMAMA_MOCK: true,
  ALIMAMA_ADZONE_ID: 'mock_adzone_001',
  ALIMAMA_BASE_URL: 'https://gw.api.taobao.com/router/rest',
  OCP_AUTO_SYNC: false,
};

function fakeClient(impl: Partial<AlimamaClient>): AlimamaClient {
  return impl as AlimamaClient;
}

async function postResolveHook(
  app: ReturnType<typeof createResolveHookRoutes>,
  body: unknown,
  secret = baseCfg.OCP_PROVIDER_HOOK_SECRET,
) {
  return app.handle(
    new Request('http://localhost/provider/resolve_hook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(secret ? { 'x-provider-hook-secret': secret } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

describe('resolve-hook endpoint', () => {
  test('alimama 正常返回 → 输出 provider-owned affiliate links', async () => {
    const mockResponse: AlimamaPrivilegeResponse = {
      tbk_privilege_get_response: {
        result: {
          data: {
            coupon_click_url: 'https://s.click.taobao.com/test_coupon',
            coupon_info: '满 50 减 5',
          },
        },
      },
    };
    let captured: { itemId?: string; externalId?: string } = {};
    const client = fakeClient({
      generatePrivilegeLink: async (opts: any) => {
        captured = { itemId: opts.itemId, externalId: opts.externalId };
        return mockResponse;
      },
    });
    const app = createResolveHookRoutes({ alimama: client, cfg: baseCfg });

    const res = await postResolveHook(app, {
      entry_id: 'centry_abc',
      object_id: 700123456001,
      agent_id: 'agt_test',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { links: any[] };
    expect(body.links).toHaveLength(1);
    expect(body.links[0]).toMatchObject({
      link_id: 'buy_with_coupon',
      url: 'https://s.click.taobao.com/test_coupon',
    });

    // 透传校验:object_id 被转 string, entry_id 进了 externalId
    expect(captured.itemId).toBe('700123456001');
    expect(captured.externalId).toBe('centry_abc');
  });

  test('alimama 抛 AlimamaApiError → 降级返空 links', async () => {
    const client = fakeClient({
      generatePrivilegeLink: async () => {
        throw new AlimamaApiError('isv.access-limit', 'rate limited');
      },
    });
    const app = createResolveHookRoutes({ alimama: client, cfg: baseCfg });

    const res = await postResolveHook(app, {
      entry_id: 'centry_x',
      object_id: '12345',
    });
    expect(res.status).toBe(200); // 关键:不是 500
    const body = (await res.json()) as { links: any[] };
    expect(body.links).toEqual([]);
  });

  test('alimama 抛意外错误(如 TypeError) → 也降级返空', async () => {
    const client = fakeClient({
      generatePrivilegeLink: async () => {
        throw new TypeError('something weird');
      },
    });
    const app = createResolveHookRoutes({ alimama: client, cfg: baseCfg });

    const res = await postResolveHook(app, {
      entry_id: 'centry_y',
      object_id: 999,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { links: any[] };
    expect(body.links).toEqual([]);
  });

  test('alimama 返畸形响应 (data undefined) → 空 links', async () => {
    const client = fakeClient({
      generatePrivilegeLink: async () =>
        ({ tbk_privilege_get_response: { result: { data: undefined } } } as any),
    });
    const app = createResolveHookRoutes({ alimama: client, cfg: baseCfg });

    const res = await postResolveHook(app, {
      entry_id: 'centry_z',
      object_id: 1,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { links: any[] };
    expect(body.links).toEqual([]);
  });

  test('真实 mock client(走 fixture)端到端', async () => {
    // 用真实 AlimamaClient 在 mock 模式下读 fixture
    const { AlimamaClient } = await import('../src/alimama/client');
    const realMockClient = new AlimamaClient(baseCfg);
    const app = createResolveHookRoutes({ alimama: realMockClient, cfg: baseCfg });

    const res = await postResolveHook(app, {
      entry_id: 'centry_fixture_test',
      object_id: 700123456001,
      agent_id: 'agt_fixture',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { links: any[] };
    // fixture 同时有 coupon_click_url 和 mm_coupon_click_url(不同) → 2 个 link
    expect(body.links).toHaveLength(2);
    expect(body.links[0]!.url).toContain('s.click.taobao.com');
  });

  test('缺 hook secret → 401', async () => {
    const client = fakeClient({ generatePrivilegeLink: async () => ({} as any) });
    const app = createResolveHookRoutes({ alimama: client, cfg: baseCfg });
    const res = await postResolveHook(app, { entry_id: 'centry_x', object_id: 1 }, '');
    expect(res.status).toBe(401);
  });

  test('缺 entry_id → 入参校验失败', async () => {
    const client = fakeClient({ generatePrivilegeLink: async () => ({} as any) });
    const app = createResolveHookRoutes({ alimama: client, cfg: baseCfg });
    const res = await postResolveHook(app, { object_id: 1 });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
