/**
 * OCP Skill Gateway 入口。
 */
import { loadSkillGatewayConfig } from './config';
import { createSkillGatewayApp } from './app';

const cfg = loadSkillGatewayConfig();
const app = createSkillGatewayApp({ cfg }).listen(cfg.SKILL_GATEWAY_PORT);

const upstreamLabel =
  cfg.SKILL_GATEWAY_UPSTREAM === 'ocp_mcp'
    ? `ocp_mcp(${cfg.SKILL_GATEWAY_OCP_MCP_URL})`
    : cfg.SKILL_GATEWAY_UPSTREAM === 'ocp_http'
      ? `ocp_http(${cfg.SKILL_GATEWAY_OCP_REGISTRATION_URL})`
      : `local_catalogs(${cfg.SKILL_GATEWAY_CATALOGS.length})`;
console.log(
  `[ocp-skill-gateway] listening on http://localhost:${app.server?.port ?? cfg.SKILL_GATEWAY_PORT}` +
    `, upstream=${upstreamLabel}` +
    `, api_keys=${cfg.SKILL_GATEWAY_API_KEYS.size}`,
);
