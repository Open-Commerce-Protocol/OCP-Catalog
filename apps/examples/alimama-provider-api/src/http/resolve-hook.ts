/**
 * /provider/resolve_hook 端点 — Day 5 真实实现。
 *
 * Catalog 在 resolve 时回调我们,我们调阿里 taobao.tbk.privilege.get 拿带 PID 的购买链接,
 * 映射成 OCP ActionBinding[] 返回。
 *
 * Day 3 阶段是 stub (始终返空),Day 5 替换为本实现。
 *
 * 失败策略:任何阶段出错(alimama 限流、超时、响应畸形)都返空 binding。
 * Catalog 端有自己的降级(只返 view_product),Provider 失败不会让 resolve 整体挂掉。
 */
import { Elysia, t } from 'elysia';
import type { AlimamaClient } from '../alimama/client';
import { AlimamaApiError } from '../alimama/client';
import type { AlimamaConfig } from '../config';
import { privilegeToActionBindings } from '../mapper/privilege-to-action';

export interface ResolveHookDeps {
  alimama: AlimamaClient;
  cfg: AlimamaConfig;
}

export function createResolveHookRoutes(deps: ResolveHookDeps) {
  return new Elysia({ prefix: '/provider/resolve_hook' }).post(
    '/',
    async ({ body }) => {
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
        const bindings = privilegeToActionBindings(data);

        console.log(`[resolve_hook] ✓ returned ${bindings.length} binding(s) for object=${objectId}`);
        return { action_bindings: bindings };
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
        return { action_bindings: [] };
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
