import type { CatalogManifest } from '@ocp-catalog/ocp-schema';
import type { CatalogRegistration } from '@ocp-catalog/center-schema';

type QueryCapabilitySource = Pick<CatalogManifest, 'query_capabilities'>;

export function objectContractSummaries(manifest: CatalogManifest) {
  return manifest.object_contracts.map((contract) => ({
    contract_id: contract.contract_id,
    object_type: contract.object_type,
    required_packs: contract.required_packs,
    optional_packs: contract.optional_packs,
  }));
}

export function supportedQueryModes(manifest: QueryCapabilitySource) {
  return unique(manifest.query_capabilities.flatMap((capability) => queryPackDescriptors(capability).flatMap((descriptor) => descriptor.query_modes)));
}

export function supportedQueryPacks(manifest: QueryCapabilitySource) {
  return unique(manifest.query_capabilities.flatMap((capability) => [
    stringValue(capability.capability_id),
    ...queryPackDescriptors(capability).map((descriptor) => descriptor.pack_id),
  ].filter((value): value is string => Boolean(value))));
}

export function supportedQueryLanguages(manifest: QueryCapabilitySource) {
  return unique(manifest.query_capabilities.flatMap((capability) => metadataStringArray(capability, 'query_hints', 'supported_query_languages')));
}

export function contentLanguages(manifest: QueryCapabilitySource) {
  return unique(manifest.query_capabilities.flatMap((capability) => metadataStringArray(capability, 'query_hints', 'content_languages')));
}

export function supportsResolve(manifest: QueryCapabilitySource) {
  return manifest.query_capabilities.some((capability) => capability.supports_resolve === true);
}

export function buildCatalogSearchProjection(
  registration: CatalogRegistration,
  manifest: CatalogManifest,
  verificationStatus: string,
  trustTier: string,
  healthStatus: string,
) {
  const modes = supportedQueryModes(manifest);
  const queryPacks = supportedQueryPacks(manifest);
  const queryLanguages = supportedQueryLanguages(manifest);
  const contentLangs = contentLanguages(manifest);
  const contracts = objectContractSummaries(manifest);
  const text = [
    manifest.catalog_name,
    manifest.description,
    registration.operator.display_name,
    ...registration.tags,
    ...registration.claimed_domains,
    ...manifest.supported_object_types,
    ...modes,
    ...queryPacks,
    ...queryLanguages,
    ...contentLangs,
    ...contracts.map((contract) => contract.object_type),
    verificationStatus,
    trustTier,
    healthStatus,
  ].filter(Boolean).join(' ').toLowerCase();

  return {
    catalog_name: manifest.catalog_name,
    description: manifest.description,
    operator: registration.operator.display_name,
    tags: registration.tags,
    domains: registration.claimed_domains,
    supported_object_types: manifest.supported_object_types,
    supported_query_modes: modes,
    supported_query_packs: queryPacks,
    object_contract_summaries: contracts,
    supports_resolve: supportsResolve(manifest),
    metadata: {
      query_hints: {
        supported_query_modes: modes,
        supported_query_languages: queryLanguages,
        content_languages: contentLangs,
      },
    },
    verification_status: verificationStatus,
    trust_tier: trustTier,
    health_status: healthStatus,
    query_url: manifest.endpoints.query.url,
    resolve_url: manifest.endpoints.resolve?.url,
    text,
  };
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function metadataStringArray(capability: Record<string, unknown>, metadataKey: string, childKey: string) {
  const metadata = asRecord(capability.metadata);
  const nested = asRecord(metadata[metadataKey]);
  return stringArray(nested[childKey]);
}

function queryPackDescriptors(capability: Record<string, unknown>) {
  const queryPacks = capability.query_packs;
  if (!Array.isArray(queryPacks)) return [];

  return queryPacks
    .map((queryPack) => {
      if (typeof queryPack === 'string') {
        return { pack_id: queryPack, query_modes: [] as string[] };
      }

      const record = asRecord(queryPack);
      const packId = stringValue(record.pack_id);
      if (!packId) return null;

      return {
        pack_id: packId,
        query_modes: stringArray(record.query_modes),
      };
    })
    .filter((queryPack): queryPack is { pack_id: string; query_modes: string[] } => Boolean(queryPack));
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function unique<T>(values: T[]) {
  return [...new Set(values)];
}

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
