import type { AppConfig } from '@ocp-catalog/config';
import { centerDiscoverySchema, centerManifestSchema, type CenterDiscovery, type CenterManifest } from '@ocp-catalog/center-schema';

export function buildCenterDiscovery(config: AppConfig): CenterDiscovery {
  const baseUrl = config.CENTER_PUBLIC_BASE_URL.replace(/\/$/, '');
  return centerDiscoverySchema.parse({
    ocp_version: '1.0',
    kind: 'CenterDiscovery',
    center_id: config.CENTER_ID,
    center_name: config.CENTER_NAME,
    center_protocol: 'ocp.catalog.center.v1',
    center_protocol_version: '1.0.0',
    manifest_url: `${baseUrl}/ocp/center/manifest`,
    catalog_registration_url: `${baseUrl}/ocp/catalogs/register`,
    catalog_search_url: `${baseUrl}/ocp/catalogs/search`,
  });
}

export function buildCenterManifest(config: AppConfig): CenterManifest {
  const baseUrl = config.CENTER_PUBLIC_BASE_URL.replace(/\/$/, '');
  return centerManifestSchema.parse({
    ocp_version: '1.0',
    kind: 'CenterManifest',
    center_id: config.CENTER_ID,
    center_name: config.CENTER_NAME,
    supported_protocols: ['ocp.catalog.center.v1', 'ocp.catalog.handshake.v1'],
    endpoints: {
      catalog_registration: `${baseUrl}/ocp/catalogs/register`,
      catalog_search: `${baseUrl}/ocp/catalogs/search`,
      catalog_resolve: `${baseUrl}/ocp/catalogs/resolve`,
      catalog_verify: `${baseUrl}/ocp/catalogs/{catalog_id}/verify`,
      catalog_refresh: `${baseUrl}/ocp/catalogs/{catalog_id}/refresh`,
      catalog_token_rotate: `${baseUrl}/ocp/catalogs/{catalog_id}/token/rotate`,
    },
    catalog_registration: {
      registration_modes: ['open_intake'],
      default_status: 'pending_verification',
      requires_domain_verification: true,
      requires_https: true,
    },
    catalog_search_capabilities: [
      {
        capability_id: 'center.catalog.keyword.v1',
        query_modes: ['keyword', 'filter'],
        filter_fields: [
          'object_type',
          'query_mode',
          'query_pack',
          'supports_resolve',
          'verification_status',
          'trust_tier',
          'health_status',
          'domain',
          'tag',
        ],
        supports_explain: true,
      },
    ],
  });
}
