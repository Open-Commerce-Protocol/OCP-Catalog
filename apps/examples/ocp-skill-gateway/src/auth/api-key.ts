/**
 * API Key 鉴权(Skill 平台插件调用方使用)。
 *
 * 平台插件配置里设置 Header `X-Skill-Key`,
 * Gateway 校验 key 是否在白名单内,并把 api_key_id 注入到上下文供 telemetry 用。
 *
 * M1:静态白名单 (env 配),M2 切到 DB 表。
 */
import { Elysia } from 'elysia';
import type { SkillGatewayConfig } from '../config';

export interface ApiKeyContext {
  api_key_id: string;
}

export function apiKeyMiddleware(cfg: SkillGatewayConfig) {
  return new Elysia({ name: 'api-key-auth' }).derive(
    { as: 'global' },
    ({ headers, request, set }) => {
      const url = new URL(request.url);
      // 只对 /skill/* 强制校验;health / openapi / dashboard 不受影响
      if (!url.pathname.startsWith('/skill/')) {
        return { api_key_id: undefined as string | undefined };
      }
      const key = headers['x-skill-key'] ?? headers['X-Skill-Key'];
      if (!key || !cfg.SKILL_GATEWAY_API_KEYS.has(key)) {
        set.status = 401;
        throw new SkillAuthError('invalid or missing X-Skill-Key');
      }
      return { api_key_id: key as string };
    },
  );
}

export class SkillAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillAuthError';
  }
}
