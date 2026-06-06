import type { AppConfig } from '@ocp-catalog/config';
import { catalogManifestSchema, type CatalogDataProfile, type CatalogManifest } from '@ocp-catalog/ocp-schema';
import type { CatalogScenarioModule } from './scenario';
import { defaultProviderFieldRules, defaultProviderSyncCapabilities } from './scenario';

export function buildWellKnownDiscovery(config: AppConfig) {
  const baseUrl = config.CATALOG_PUBLIC_BASE_URL.replace(/\/$/, '');

  return {
    ocp_version: '1.0',
    kind: 'WellKnownCatalogDiscovery',
    catalog_id: config.CATALOG_ID,
    catalog_name: config.CATALOG_NAME,
    handshake_package: 'ocp.catalog.handshake.v1',
    handshake_package_version: '1.0.0',
    manifest_url: `${baseUrl}/ocp/manifest`,
    contracts_url: `${baseUrl}/ocp/contracts`,
    provider_registration_url: `${baseUrl}/ocp/providers/register`,
    object_sync_url: `${baseUrl}/ocp/objects/sync`,
    object_sync_stream_url: `${baseUrl}/ocp/objects/sync/stream`,
    object_sync_run_url: `${baseUrl}/ocp/object-sync-runs/{sync_run_id}?provider_id={provider_id}`,
    object_sync_run_complete_url: `${baseUrl}/ocp/object-sync-runs/{sync_run_id}/complete?provider_id={provider_id}`,
    health_url: `${baseUrl}/ocp/health`,
    query_url: `${baseUrl}/ocp/query`,
    resolve_url: `${baseUrl}/ocp/resolve`,
  };
}

export type BuildCatalogManifestOptions = {
  dataProfile?: CatalogDataProfile;
};

export function buildCatalogManifest(
  config: AppConfig,
  scenario: CatalogScenarioModule,
  options: BuildCatalogManifestOptions = {},
): CatalogManifest {
  const baseUrl = config.CATALOG_PUBLIC_BASE_URL.replace(/\/$/, '');
  const objectContracts = scenario.objectContracts();
  const manifest: CatalogManifest = {
    ocp_version: '1.0',
    kind: 'CatalogManifest',
    id: `manifest_${config.CATALOG_ID}`,
    catalog_id: config.CATALOG_ID,
    catalog_name: config.CATALOG_NAME,
    description: scenario.description ?? 'Protocol-first OCP Catalog node.',
    registry_visibility: scenario.registryVisibility ?? 'public',
    endpoints: {
      health: { url: `${baseUrl}/ocp/health`, method: 'GET' },
      query: { url: `${baseUrl}/ocp/query`, method: 'POST' },
      resolve: { url: `${baseUrl}/ocp/resolve`, method: 'POST' },
      provider_registration: { url: `${baseUrl}/ocp/providers/register`, method: 'POST' },
      contracts: { url: `${baseUrl}/ocp/contracts`, method: 'GET' },
      object_sync: { url: `${baseUrl}/ocp/objects/sync`, method: 'POST' },
      object_sync_stream: { url: `${baseUrl}/ocp/objects/sync/stream`, method: 'POST' },
      object_sync_run: { url: `${baseUrl}/ocp/object-sync-runs/{sync_run_id}?provider_id={provider_id}`, method: 'GET' },
      object_sync_run_complete: { url: `${baseUrl}/ocp/object-sync-runs/{sync_run_id}/complete?provider_id={provider_id}`, method: 'POST' },
    },
    query_capabilities: scenario.queryCapabilities(),
    ...(options.dataProfile ? { data_profile: options.dataProfile } : {}),
    provider_contract: {
      field_rules: scenario.providerFieldRules?.() ?? defaultProviderFieldRules(),
      sync_capabilities: scenario.providerSyncCapabilities?.() ?? defaultProviderSyncCapabilities(),
    },
    object_contracts: objectContracts,
  };

  return catalogManifestSchema.parse(manifest);
}
