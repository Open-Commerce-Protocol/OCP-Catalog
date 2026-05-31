/**
 * OCP Skill Gateway 应用装配。
 *
 * 路由分层:
 *   /skill/*       LLM 调用,需 X-Skill-Key 鉴权,出现在 OpenAPI 里
 *   /dashboard/*   浏览器调,无鉴权(M2 加 session)
 *   /admin/*       内部,M2 加管理员鉴权
 *   /openapi.yaml  给各平台插件市场下载
 *   /health        服务存活
 */
import { cors } from '@elysiajs/cors';
import { Elysia } from 'elysia';
import type { SkillGatewayConfig } from './config';
import { type BrokerClient, LocalCatalogsBrokerClient } from './broker/client';
import { OcpMcpBrokerClient } from './broker/ocp-mcp-client';
import { OcpHttpBrokerClient } from './broker/ocp-http-client';
import { TelemetryRecorder } from './telemetry/recorder';
import { apiKeyMiddleware, SkillAuthError } from './auth/api-key';
import { createSearchRoute } from './routes/skill/search';
import { createDeeplinkRoute } from './routes/skill/deeplink';
import { createCompareRoute } from './routes/skill/compare';
import { createRecommendRoute } from './routes/skill/recommend';
import { createOrderRoute } from './routes/skill/order';
import { createDashboardRoutes } from './routes/dashboard/stats';
import { createAdminRoutes } from './routes/admin/api-keys';
import { buildOpenApiYaml } from './openapi';

export interface SkillGatewayDeps {
  cfg: SkillGatewayConfig;
}

export function createSkillGatewayApp(deps: SkillGatewayDeps) {
  const broker: BrokerClient = selectBroker(deps.cfg);
  const telemetry = new TelemetryRecorder(deps.cfg);

  return new Elysia()
    .use(cors({ origin: false }))
    .onError(({ error, set }) => {
      if (error instanceof SkillAuthError) {
        set.status = 401;
        return { error: { code: 'unauthorized', message: error.message } };
      }
      set.status = 500;
      return {
        error: {
          code: 'internal_error',
          message: error instanceof Error ? error.message : 'unknown',
        },
      };
    })
    .get('/health', () => ({
      ok: true,
      service: 'ocp-skill-gateway',
      upstream: deps.cfg.SKILL_GATEWAY_UPSTREAM,
      upstream_url: upstreamUrl(deps.cfg),
      api_keys_loaded: deps.cfg.SKILL_GATEWAY_API_KEYS.size,
    }))
    .get('/openapi.yaml', ({ set }) => {
      set.headers['content-type'] = 'application/yaml; charset=utf-8';
      return buildOpenApiYaml(deps.cfg);
    })
    .use(apiKeyMiddleware(deps.cfg))
    .use(createSearchRoute({ broker, telemetry }))
    .use(createDeeplinkRoute({ broker, telemetry }))
    .use(createCompareRoute({ broker, telemetry }))
    .use(createRecommendRoute({ broker, telemetry }))
    .use(createOrderRoute({ telemetry }))
    .use(createDashboardRoutes({ broker, telemetry }))
    .use(createAdminRoutes(deps.cfg));
}

/** 按 SKILL_GATEWAY_UPSTREAM 选上游 broker。routes 不感知具体实现。 */
function selectBroker(cfg: SkillGatewayConfig): BrokerClient {
  switch (cfg.SKILL_GATEWAY_UPSTREAM) {
    case 'ocp_mcp':
      return new OcpMcpBrokerClient(cfg);
    case 'ocp_http':
      return new OcpHttpBrokerClient(cfg);
    case 'local_catalogs':
      return new LocalCatalogsBrokerClient(cfg);
  }
}

/** /health 里展示的上游地址,纯信息用途。 */
function upstreamUrl(cfg: SkillGatewayConfig): string {
  switch (cfg.SKILL_GATEWAY_UPSTREAM) {
    case 'ocp_mcp':
      return cfg.SKILL_GATEWAY_OCP_MCP_URL;
    case 'ocp_http':
      return cfg.SKILL_GATEWAY_OCP_REGISTRATION_URL;
    case 'local_catalogs':
      return `${cfg.SKILL_GATEWAY_CATALOGS.length} local catalogs`;
  }
}
