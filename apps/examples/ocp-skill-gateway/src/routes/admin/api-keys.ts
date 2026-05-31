/**
 * Admin API。M1 仅暴露查看接口(API Key 增删改在 M2 接 DB 后做)。
 */
import { Elysia } from 'elysia';
import type { SkillGatewayConfig } from '../../config';

export function createAdminRoutes(cfg: SkillGatewayConfig) {
  return new Elysia({ prefix: '/admin' }).get('/api-keys', () => ({
    // 仅返回 mask 后的 key,避免日志/截图泄露
    keys: [...cfg.SKILL_GATEWAY_API_KEYS].map((k) => ({
      masked: maskKey(k),
      length: k.length,
    })),
  }));
}

function maskKey(k: string): string {
  if (k.length <= 6) return k[0] + '***';
  return `${k.slice(0, 4)}***${k.slice(-2)}`;
}
