import { describe, expect, test } from 'bun:test';
import type { CatalogManifest } from '@ocp-catalog/ocp-schema';
import type { CatalogRegistration } from '@ocp-catalog/registration-schema';
import { buildCatalogSearchProjection, supportedQueryPacks } from './projection';

describe('registration projection', () => {
  test('supportedQueryPacks returns query pack ids, not query capability ids', () => {
    expect(supportedQueryPacks({
      query_capabilities: [
        {
          capability_id: 'ocp.commerce.product.search.v1',
          query_packs: [
            { pack_id: 'ocp.query.keyword.v1', query_modes: ['keyword'], metadata: {} },
            { pack_id: 'ocp.query.filter.v1', query_modes: ['filter'], metadata: {} },
          ],
        },
      ] as CatalogManifest['query_capabilities'],
    })).toEqual(['ocp.query.keyword.v1', 'ocp.query.filter.v1']);
  });

  test('federation projection is optional and keeps existing route hint fields available', () => {
    const projection = buildCatalogSearchProjection(baseRegistration, baseManifest, 'not_required', 'declared', 'healthy');

    expect(projection).toMatchObject({
      catalog_name: 'Commerce Catalog',
      query_url: 'https://catalog.example.com/ocp/query',
      resolve_url: 'https://catalog.example.com/ocp/resolve',
      supported_query_packs: ['ocp.query.keyword.v1'],
      supports_resolve: true,
    });
    expect(projection).not.toHaveProperty('federation');
    expect(projection).not.toHaveProperty('trust_profile');
  });

  test('federation projection summarizes manifest federation and trust strategy', () => {
    const projection = buildCatalogSearchProjection({
      ...baseRegistration,
      tags: ['commerce', 'trusted'],
    }, {
      ...baseManifest,
      federation: {
        mode: 'summary_exchange',
        node_role: 'source_catalog',
        peer_policy: {
          accepts_peers: false,
          requires_verification: true,
          allowed_peer_ids: [],
        },
        supported_protocols: ['ocp.catalog.registration.v1'],
        remote_query: {
          supported: false,
          routing_modes: ['route_hint'],
          accepted_query_packs: [],
          requires_trust_tier: 'verified',
          returns_authoritative_results: false,
        },
        remote_resolve: {
          supported: false,
          allowed_reference_types: ['commercial_object'],
          requires_live_check: true,
          cache_policy: 'source_ttl',
          auth_context_required: true,
          requires_trust_tier: 'verified',
        },
        summary_cache: {
          supported: true,
          summary_types: ['profile', 'contract', 'catalog_entry'],
          ttl_seconds: 300,
          includes_object_payloads: false,
        },
        mutation_log: {
          supported: true,
          event_types: ['snapshot_created', 'entry_upserted', 'trust_changed'],
          cursor_required: true,
          includes_tombstones: true,
        },
        trust_strategy: {
          trust_tier: 'verified',
          domain_verified: true,
          manifest_signed: true,
          signature_algorithms: ['ed25519'],
          downgrade_invalidates_cache: true,
        },
      },
    }, 'verified', 'verified', 'healthy');

    expect(projection.federation).toEqual({
      mode: 'summary_exchange',
      node_role: 'source_catalog',
      remote_query_supported: false,
      remote_resolve_supported: false,
      summary_cache_supported: true,
      mutation_log_supported: true,
    });
    expect(projection.trust_profile).toEqual({
      verification_status: 'verified',
      trust_tier: 'verified',
      domain_verified: true,
      manifest_signed: true,
      signature_alg: 'ed25519',
      downgrade_invalidates_cache: true,
    });
  });
});

const baseRegistration: CatalogRegistration = {
  ocp_version: '1.0',
  kind: 'CatalogRegistration',
  id: 'catreg_1',
  registration_id: 'reg_1',
  catalog_id: 'catalog_1',
  registration_version: 1,
  updated_at: '2026-01-01T00:00:00.000Z',
  homepage: 'https://catalog.example.com',
  well_known_url: 'https://catalog.example.com/.well-known/ocp/catalog.json',
  claimed_domains: ['catalog.example.com'],
  operator: {
    display_name: 'Catalog Operator',
  },
  intended_visibility: 'public',
  tags: ['commerce'],
};

const baseManifest: CatalogManifest = {
  ocp_version: '1.0',
  kind: 'CatalogManifest',
  id: 'manifest_1',
  catalog_id: 'catalog_1',
  catalog_name: 'Commerce Catalog',
  description: 'Demo catalog',
  registry_visibility: 'public',
  endpoints: {
    query: { url: 'https://catalog.example.com/ocp/query', method: 'POST' },
    resolve: { url: 'https://catalog.example.com/ocp/resolve', method: 'POST' },
    provider_registration: { url: 'https://catalog.example.com/ocp/providers/register', method: 'POST' },
    contracts: { url: 'https://catalog.example.com/ocp/contracts', method: 'GET' },
    object_sync: { url: 'https://catalog.example.com/ocp/sync', method: 'POST' },
  },
  query_capabilities: [
    {
      capability_id: 'ocp.commerce.product.search.v1',
      query_packs: [
        { pack_id: 'ocp.query.keyword.v1', query_modes: ['keyword'], metadata: {} },
      ],
      searchable_field_refs: [],
      filterable_field_refs: [],
      sortable_field_refs: [],
      input_fields: [],
      supports_explain: true,
      supports_resolve: true,
      metadata: {},
    },
  ],
  provider_contract: {
    field_rules: [],
    sync_capabilities: [],
  },
  object_contracts: [
    {
      required_fields: ['ocp.commerce.product.core.v1#/title'],
      optional_fields: [],
      additional_fields_policy: 'allow',
    },
  ],
};
