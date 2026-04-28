import type { CatalogRouteHint } from '@ocp-catalog/registration-schema';
import { McpToolError } from '../errors';
import { TtlCache } from './cache';
import type { RegistrationClient } from './registration-client';

const routeHintCache = new TtlCache<CatalogRouteHint>();

export async function resolveRouteHint(args: {
  routeHint?: CatalogRouteHint;
  catalogId?: string;
  registrationBaseUrl?: string;
  registrationClient: RegistrationClient;
}) {
  if (args.routeHint) return assertUsableRouteHint(args.routeHint);
  if (!args.catalogId || !args.registrationBaseUrl) {
    throw new McpToolError('catalog_not_found', 'catalog_id requires registration_base_url when route_hint is omitted');
  }

  const cacheKey = `${args.registrationBaseUrl}:${args.catalogId}`;
  const cached = routeHintCache.get(cacheKey);
  if (cached) return assertUsableRouteHint(cached);

  const routeHint = await args.registrationClient.resolve(args.registrationBaseUrl, args.catalogId);
  routeHintCache.set(cacheKey, routeHint, routeHint.cache_ttl_seconds * 1000);
  return assertUsableRouteHint(routeHint);
}

export function assertUsableRouteHint(routeHint: CatalogRouteHint) {
  if (!routeHint.manifest_url || !routeHint.query_url) {
    throw new McpToolError('catalog_not_found', 'route hint is missing manifest_url or query_url', {
      catalog_id: routeHint.catalog_id,
    });
  }

  return routeHint;
}
