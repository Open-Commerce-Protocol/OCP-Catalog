import type { SkillDeeplinkInput } from '../schemas/tool-inputs';
import type { ToolDeps } from './context';
import { skillHeaders, stripTrailingSlash } from './skill-search';

export async function skillDeeplinkTool(input: SkillDeeplinkInput, deps: ToolDeps) {
  const url = `${stripTrailingSlash(deps.config.OCP_MCP_SKILL_GATEWAY_URL)}/skill/deeplink`;
  const res = await fetch(url, {
    method: 'POST',
    headers: skillHeaders(deps),
    body: JSON.stringify({
      catalog_id: input.catalog_id,
      entry_ref: input.entry_ref,
      sub_id: input.sub_id,
    }),
    signal: AbortSignal.timeout(deps.config.OCP_MCP_REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`skill-gateway /skill/deeplink ${res.status}: ${detail.slice(0, 300)}`);
  }
  return await res.json();
}
