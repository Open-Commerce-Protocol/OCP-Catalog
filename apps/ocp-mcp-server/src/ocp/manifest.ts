import type { CatalogManifest } from '@ocp-catalog/ocp-schema';
import type { CatalogRouteHint } from '@ocp-catalog/registration-schema';
import { McpToolError } from '../errors';
import { TtlCache } from './cache';
import type { CatalogClient } from './catalog-client';

const manifestCache = new TtlCache<CatalogManifest>();

export async function loadCatalogManifest(args: {
  routeHint: CatalogRouteHint;
  catalogClient: CatalogClient;
}) {
  const cached = manifestCache.get(args.routeHint.manifest_url);
  if (cached) return cached;

  const manifest = await args.catalogClient.getManifest(args.routeHint.manifest_url);
  manifestCache.set(args.routeHint.manifest_url, manifest, Math.min(args.routeHint.cache_ttl_seconds, 300) * 1000);
  return manifest;
}

export function summarizeManifest(manifest: CatalogManifest) {
  const supportedQueryPacks = manifest.query_capabilities.flatMap((capability) => (
    capability.query_packs.map((pack) => pack.pack_id)
  ));
  const supportedQueryModes = manifest.query_capabilities.flatMap((capability) => (
    capability.query_packs.flatMap((pack) => pack.query_modes)
  ));
  const supportedFilterFields = manifest.query_capabilities.flatMap((capability) => (
    capability.input_fields
      .map((field) => typeof field.name === 'string' ? field.name : null)
      .filter((name): name is string => Boolean(name?.startsWith('filters.')))
      .map((name) => name.replace(/^filters\./, ''))
  ));
  const queryHints = manifest.query_capabilities.flatMap((capability) => (
    [capability.metadata.query_hints].filter(isRecord)
  ));

  return {
    supported_query_packs: unique(supportedQueryPacks),
    supported_query_modes: unique(supportedQueryModes),
    supported_filter_fields: unique(supportedFilterFields),
    supported_query_languages: unique(queryHints.flatMap((hint) => stringArray(hint.supported_query_languages))),
    content_languages: unique(queryHints.flatMap((hint) => stringArray(hint.content_languages))),
    supports_resolve: manifest.query_capabilities.some((capability) => capability.supports_resolve),
  };
}

export function assertSupportedQueryPack(manifest: CatalogManifest, queryPack?: string) {
  if (!queryPack) return;
  const supported = summarizeManifest(manifest).supported_query_packs;
  if (!supported.includes(queryPack)) {
    throw new McpToolError('invalid_query_pack', `unsupported query_pack: ${queryPack}`, {
      query_pack: queryPack,
      supported_query_packs: supported,
    });
  }
}

export function assertSupportedFilters(manifest: CatalogManifest, filters: Record<string, unknown>) {
  const supported = summarizeManifest(manifest).supported_filter_fields;
  if (supported.length === 0) return;

  for (const field of Object.keys(filters)) {
    if (!supported.includes(field)) {
      throw new McpToolError('invalid_filter_field', `unsupported filter field: ${field}`, {
        field,
        supported_filter_fields: supported,
      });
    }
  }
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
