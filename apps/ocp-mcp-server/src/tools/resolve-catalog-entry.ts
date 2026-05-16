import { McpToolError } from '../errors';
import { catalogRouteHintSchema } from '@ocp-catalog/registration-schema';
import { resolveRouteHint } from '../ocp/route-hints';
import type { ResolveCatalogEntryInput } from '../schemas/tool-inputs';
import type { ToolDeps } from './context';

export async function resolveCatalogEntryTool(input: ResolveCatalogEntryInput, deps: ToolDeps) {
  const routeHint = await resolveRouteHint({
    routeHint: input.route_hint ? catalogRouteHintSchema.parse(input.route_hint) : undefined,
    catalogId: input.catalog_id,
    registrationBaseUrl: input.registration_base_url ?? deps.config.OCP_MCP_DEFAULT_REGISTRATION_URL,
    registrationClient: deps.registrationClient,
  });
  const resolveUrl = routeHint.resolve_url;
  if (!resolveUrl) {
    throw new McpToolError('catalog_resolve_failed', 'selected catalog route hint does not include resolve_url', {
      catalog_id: routeHint.catalog_id,
    });
  }

  const purpose = input.purpose ?? 'view';
  const liveCheck = input.live_check ?? true;
  const requestedFields = input.requested_fields ?? [];
  const resolved = await deps.catalogClient.resolve(resolveUrl, {
    ocp_version: '1.0',
    kind: 'ResolveRequest',
    catalog_id: routeHint.catalog_id,
    entry_id: input.entry_id,
    purpose,
    live_check: liveCheck,
    requested_fields: requestedFields,
  });

  return {
    catalog_id: resolved.catalog_id,
    entry_id: resolved.entry_id,
    purpose,
    live_check: liveCheck,
    requested_fields: requestedFields,
    object_id: resolved.object_id,
    object_type: resolved.object_type,
    provider_id: resolved.provider_id,
    title: resolved.title,
    visible_attributes: resolved.visible_attributes,
    access: resolved.access,
    live_checks: resolved.live_checks,
    actions: resolved.action_bindings,
    freshness: resolved.freshness,
    expires_at: resolved.expires_at,
    resolved,
  };
}
