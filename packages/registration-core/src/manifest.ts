import type { AppConfig } from '@ocp-catalog/config';
import { registrationDiscoverySchema, registrationManifestSchema, type RegistrationDiscovery, type RegistrationManifest } from '@ocp-catalog/registration-schema';

export function buildRegistrationDiscovery(config: AppConfig): RegistrationDiscovery {
  const baseUrl = config.REGISTRATION_PUBLIC_BASE_URL.replace(/\/$/, '');
  return registrationDiscoverySchema.parse({
    ocp_version: '1.0',
    kind: 'RegistrationDiscovery',
    registration_id: config.REGISTRATION_ID,
    registration_name: config.REGISTRATION_NAME,
    registration_protocol: 'ocp.catalog.registration.v1',
    registration_protocol_version: '1.0.0',
    manifest_url: `${baseUrl}/ocp/registration/manifest`,
    catalog_registration_url: `${baseUrl}/ocp/catalogs/register`,
    catalog_search_url: `${baseUrl}/ocp/catalogs/search`,
  });
}

export function buildRegistrationManifest(config: AppConfig): RegistrationManifest {
  const baseUrl = config.REGISTRATION_PUBLIC_BASE_URL.replace(/\/$/, '');
  return registrationManifestSchema.parse({
    ocp_version: '1.0',
    kind: 'RegistrationManifest',
    registration_id: config.REGISTRATION_ID,
    registration_name: config.REGISTRATION_NAME,
    supported_protocols: ['ocp.catalog.registration.v1', 'ocp.catalog.handshake.v1'],
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
      default_status: 'accepted_indexed',
      requires_domain_verification: false,
      requires_https: false,
    },
    catalog_search_capabilities: [
      {
        capability_id: 'registration.catalog.keyword.v1',
        query_modes: ['keyword', 'filter'],
        filter_fields: [
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

