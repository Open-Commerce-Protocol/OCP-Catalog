import type {
  ActionBinding,
  CatalogManifest,
  CommercialObject,
  ObjectContract,
} from '@ocp-catalog/ocp-schema';

export type DescriptorValidationResult =
  | { ok: true; data?: unknown }
  | { ok: false; errors: string[] };

export type SearchProjection = Record<string, unknown> & {
  title: string;
  summary?: string;
  source_url?: string;
  text?: string;
};

export type CatalogScenarioModule = {
  description?: string;
  registryVisibility?: CatalogManifest['registry_visibility'];
  objectContracts(): ObjectContract[];
  providerFieldRules?(): CatalogManifest['provider_contract']['field_rules'];
  providerSyncCapabilities?(): CatalogManifest['provider_contract']['sync_capabilities'];
  queryCapabilities(): CatalogManifest['query_capabilities'];
  validateDescriptorPack(packId: string, data: unknown): DescriptorValidationResult;
  buildSearchProjection(object: CommercialObject): SearchProjection;
  buildExplainProjection?(object: CommercialObject, projection: SearchProjection): Record<string, unknown>;
  buildEmbeddingText?(object: CommercialObject, projection: SearchProjection): string | null | undefined;
  buildResolveActions?(projection: Record<string, unknown>): ActionBinding[];
};

export function defaultProviderFieldRules(): CatalogManifest['provider_contract']['field_rules'] {
  return [
    {
      field_ref: 'provider#/display_name',
      requirement: 'required',
      usage: ['identity', 'display'],
    },
    {
      field_ref: 'provider#/homepage',
      requirement: 'required',
      usage: ['identity', 'reference'],
    },
  ];
}

export function defaultProviderSyncCapabilities(): CatalogManifest['provider_contract']['sync_capabilities'] {
  return [];
}
