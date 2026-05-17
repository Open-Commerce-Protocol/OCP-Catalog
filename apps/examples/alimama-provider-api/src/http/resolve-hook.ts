/**
 * /provider/resolve_hook 端点。
 *
 * Provider-owned link endpoint: callers present x-provider-hook-secret, then we call
 * taobao.tbk.privilege.get to mint PID-attributed purchase URLs.
 *
 * 失败策略:任何阶段出错(alimama 限流、超时、响应畸形)都返空 links。
 * Catalog 端有自己的降级策略,Provider 失败不会让 resolve 整体挂掉。
 */
import { Elysia, t } from 'elysia';
import type { AlimamaClient } from '../alimama/client';
import { AlimamaApiError } from '../alimama/client';
import type { AlimamaConfig } from '../config';
import { privilegeToAffiliateLinks } from '../mapper/privilege-to-link';

export interface ResolveHookDeps {
  alimama: AlimamaClient;
  cfg: AlimamaConfig;
}

function isAuthorized(headers: Record<string, string | undefined>, expected: string): boolean {
  return headers['x-provider-hook-secret'] === expected;
}

export function createResolveHookRoutes(deps: ResolveHookDeps) {
  return new Elysia({ prefix: '/provider/resolve_hook' }).post(
    '/',
    async ({ body, headers, set }) => {
      if (!isAuthorized(headers, deps.cfg.OCP_PROVIDER_HOOK_SECRET)) {
        set.status = 401;
        return { error: { code: 'unauthorized', message: 'Invalid or missing x-provider-hook-secret' } };
      }

      const objectId = String(body.object_id);
      const adzoneId = deps.cfg.ALIMAMA_ADZONE_ID;

      console.log(
        `[resolve_hook] entry=${body.entry_id} object=${objectId} agent=${body.agent_id ?? '(none)'} adzone=${adzoneId}`,
      );

      try {
        const res = await deps.alimama.generatePrivilegeLink({
          itemId: objectId,
          adzoneId,
          // 把 OCP entry_id 透传到阿里 external_id 字段 —— 订单回执里能拿到,用于归因
          externalId: body.entry_id,
        });

        const data = res.tbk_privilege_get_response?.result?.data;
        const links = privilegeToAffiliateLinks(data);

        console.log(`[resolve_hook] ✓ returned ${links.length} link(s) for object=${objectId}`);
        return { links };
      } catch (err) {
        // 降级:任何失败都返空,让 catalog 用 view_product fallback
        if (err instanceof AlimamaApiError) {
          console.warn(
            `[resolve_hook] ✗ alimama error: subCode=${err.subCode} entry=${body.entry_id} object=${objectId}`,
          );
        } else {
          console.warn(
            `[resolve_hook] ✗ unexpected error entry=${body.entry_id}:`,
            err instanceof Error ? err.message : err,
          );
        }
        return { links: [] };
      }
    },
    {
      body: t.Object({
        entry_id: t.String(),
        object_id: t.Union([t.String(), t.Number()]),
        agent_id: t.Optional(t.String()),
      }),
    },
  );
}
