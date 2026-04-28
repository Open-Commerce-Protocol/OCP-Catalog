import { catalogRouteHintSchema } from '@ocp-catalog/registration-schema';
import { loadCatalogManifest, summarizeManifest } from '../ocp/manifest';
import { resolveRouteHint } from '../ocp/route-hints';
import type { InspectCatalogInput } from '../schemas/tool-inputs';
import type { ToolDeps } from './context';

export async function inspectCatalogTool(input: InspectCatalogInput, deps: ToolDeps) {
  const routeHint = await resolveRouteHint({
    routeHint: input.route_hint ? catalogRouteHintSchema.parse(input.route_hint) : undefined,
    catalogId: input.catalog_id,
    registrationBaseUrl: input.registration_base_url ?? deps.config.OCP_MCP_DEFAULT_REGISTRATION_URL,
    registrationClient: deps.registrationClient,
  });
  const manifest = await loadCatalogManifest({ routeHint, catalogClient: deps.catalogClient });
  const summary = summarizeManifest(manifest);

  return {
    catalog_id: manifest.catalog_id,
    catalog_name: manifest.catalog_name,
    description: manifest.description ?? routeHint.description ?? null,
    manifest_url: routeHint.manifest_url,
    query_url: routeHint.query_url,
    resolve_url: routeHint.resolve_url ?? manifest.endpoints.resolve.url,
    verification_status: routeHint.verification_status,
    trust_tier: routeHint.trust_tier,
    health_status: routeHint.health_status,
    registry_visibility: manifest.registry_visibility,
    supported_query_packs: summary.supported_query_packs,
    supported_query_modes: summary.supported_query_modes,
    supported_filter_fields: summary.supported_filter_fields,
    supported_query_languages: summary.supported_query_languages,
    content_languages: summary.content_languages,
    supports_resolve: summary.supports_resolve,
    query_capabilities: manifest.query_capabilities,
  };
}
