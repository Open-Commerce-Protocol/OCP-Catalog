import type { SkillSearchInput } from '../schemas/tool-inputs';
import type { ToolDeps } from './context';

export async function skillSearchTool(input: SkillSearchInput, deps: ToolDeps) {
  const url = `${stripTrailingSlash(deps.config.OCP_MCP_SKILL_GATEWAY_URL)}/skill/search`;
  const res = await fetch(url, {
    method: 'POST',
    headers: skillHeaders(deps),
    body: JSON.stringify({
      query: input.query,
      page: input.page,
      page_size: input.page_size,
    }),
    signal: AbortSignal.timeout(deps.config.OCP_MCP_REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`skill-gateway /skill/search ${res.status}: ${detail.slice(0, 300)}`);
  }
  return await res.json();
}

export function skillHeaders(deps: ToolDeps): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': deps.config.OCP_MCP_USER_AGENT,
  };
  if (deps.config.OCP_MCP_SKILL_GATEWAY_KEY) {
    headers['x-skill-key'] = deps.config.OCP_MCP_SKILL_GATEWAY_KEY;
  }
  return headers;
}

export function stripTrailingSlash(url: string) {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}
