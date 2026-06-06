import type { CatalogManifest, CatalogQueryResult, ResolvableReference } from '@ocp-catalog/ocp-schema';
import type { CatalogRouteHint, CatalogSearchResult } from '@ocp-catalog/registration-schema';
import type { McpGatewayConfig } from './config';
import type { ToolDeps } from './tools/context';

export const testConfig = {
  OCP_MCP_DEFAULT_REGISTRATION_URL: 'http://localhost:4100',
  OCP_MCP_REQUEST_TIMEOUT_MS: 1000,
  OCP_MCP_USER_AGENT: 'ocp-mcp-server/test',
  OCP_MCP_API_KEY: '',
} as McpGatewayConfig;

export const validRouteHint: CatalogRouteHint = {
  catalog_id: 'cat_local_dev',
  catalog_name: 'Local OCP Catalog',
  description: 'Demo commerce catalog',
  manifest_url: 'http://localhost:4000/ocp/manifest',
  query_url: 'http://localhost:4000/ocp/query',
  resolve_url: 'http://localhost:4000/ocp/resolve',
  supported_query_packs: ['ocp.query.keyword.v1', 'ocp.query.filter.v1'],
  auth_requirements: {},
  metadata: {
    query_hints: {
      supported_query_languages: ['en'],
      content_languages: ['en'],
    },
  },
  verification_status: 'verified',
  trust_tier: 'standard',
  health_status: 'healthy',
  cache_ttl_seconds: 60,
  snapshot_id: 'snapshot_1',
  snapshot_fetched_at: '2026-04-28T00:00:00.000Z',
};

export const manifest: CatalogManifest = {
  ocp_version: '1.0',
  kind: 'CatalogManifest',
  id: 'manifest_1',
  catalog_id: 'cat_local_dev',
  catalog_name: 'Local OCP Catalog',
  description: 'Demo commerce catalog',
  registry_visibility: 'public',
  endpoints: {
    query: { url: 'http://localhost:4000/ocp/query', method: 'POST' },
    resolve: { url: 'http://localhost:4000/ocp/resolve', method: 'POST' },
    provider_registration: { url: 'http://localhost:4000/ocp/providers/register', method: 'POST' },
    contracts: { url: 'http://localhost:4000/ocp/contracts', method: 'GET' },
    object_sync: { url: 'http://localhost:4000/ocp/objects/sync', method: 'POST' },
  },
  data_profile: {
    catalog_entry_count: 5,
    object_counts: [{ object_type: 'product', count: 5 }],
    counted_at: '2026-04-28T00:00:00.000Z',
  },
  query_capabilities: [
    {
      capability_id: 'ocp.commerce.product.search.v1',
      name: 'Commerce product search',
      query_packs: [
        {
          pack_id: 'ocp.query.keyword.v1',
          query_modes: ['keyword', 'hybrid'],
          metadata: {},
        },
        {
          pack_id: 'ocp.query.filter.v1',
          query_modes: ['filter', 'hybrid'],
          metadata: {},
        },
      ],
      searchable_field_refs: [],
      filterable_field_refs: [],
      sortable_field_refs: [],
      input_fields: [
        { name: 'filters.category', type: 'string' },
        { name: 'filters.in_stock_only', type: 'boolean' },
      ],
      supports_explain: true,
      supports_resolve: true,
      metadata: {
        query_hints: {
          supported_query_languages: ['en'],
          content_languages: ['en'],
        },
      },
    },
  ],
  provider_contract: {
    field_rules: [],
    sync_capabilities: [],
  },
  object_contracts: [
    {
      required_fields: [
        'ocp.commerce.product.core.v1#/title',
        'ocp.commerce.price.v1#/currency',
        'ocp.commerce.price.v1#/amount',
      ],
      optional_fields: [],
      additional_fields_policy: 'allow',
    },
  ],
};

export const searchResult: CatalogSearchResult = {
  ocp_version: '1.0',
  kind: 'CatalogSearchResult',
  id: 'search_1',
  registration_id: 'ocp_registry_public',
  result_count: 1,
  items: [
    {
      catalog_id: validRouteHint.catalog_id,
      catalog_name: validRouteHint.catalog_name,
      description: validRouteHint.description,
      score: 1,
      matched_query_packs: ['ocp.query.keyword.v1'],
      verification_status: validRouteHint.verification_status,
      trust_tier: validRouteHint.trust_tier,
      health_status: validRouteHint.health_status,
      route_hint: validRouteHint,
      explain: ['matched commerce'],
    },
  ],
  explain: ['returned one catalog'],
};

export const queryResult: CatalogQueryResult = {
  ocp_version: '1.0',
  kind: 'CatalogQueryResult',
  id: 'query_1',
  catalog_id: 'cat_local_dev',
  query_pack: 'ocp.query.keyword.v1',
  query: 'wireless headphones',
  result_count: 1,
  page: {
    limit: 10,
    offset: 0,
    has_more: false,
  },
  entries: [
    {
      entry: {
        kind: 'CatalogEntry',
        catalog_id: 'cat_local_dev',
        entry_id: 'entry_1',
        provider_id: 'provider_1',
        object_id: 'object_1',
        object_type: 'product',
        commercial_object_id: 'commercial_object_1',
        title: 'Demo Headphones',
        summary: 'Wireless demo headphones',
        attributes: {
          category: 'electronics',
        },
      },
      score: 0.95,
      explain: ['keyword match'],
    },
  ],
  explain: ['query complete'],
};

export const resolvedReference: ResolvableReference = {
  ocp_version: '1.0',
  kind: 'ResolvableReference',
  id: 'resolve_1',
  catalog_id: 'cat_local_dev',
  entry_id: 'entry_1',
  commercial_object_id: 'commercial_object_1',
  object_id: 'object_1',
  object_type: 'product',
  provider_id: 'provider_1',
  registration_version: 1,
  title: 'Demo Headphones',
  visible_attributes: {
    category: 'electronics',
  },
  access: {
    visibility: 'public',
    permission_state: 'granted',
    redacted_fields: ['product_url', 'source_url', 'text'],
    policy_notes: [],
  },
  live_checks: [
    {
      check_id: 'availability',
      status: 'passed',
      checked_at: '2026-04-28T00:00:00.000Z',
      summary: 'in_stock',
      details: {
        availability_status: 'in_stock',
      },
    },
  ],
  action_bindings: [
    {
      action_id: 'view_product',
      action_type: 'url',
      label: 'View product',
      description: 'Open product page',
      entrypoint: {
        url: 'https://example.test/product',
        method: 'GET',
      },
      auth_requirements: {},
      requires_user_confirmation: false,
    },
  ],
  freshness: {
    object_updated_at: '2026-04-28T00:00:00.000Z',
    resolved_at: '2026-04-28T00:00:00.000Z',
  },
  expires_at: '2026-04-28T01:00:00.000Z',
};

export function createToolDeps(overrides: Partial<ToolDeps> = {}): ToolDeps {
  return {
    config: testConfig,
    registrationClient: {
      search: async () => searchResult,
      resolve: async () => validRouteHint,
    },
    catalogClient: {
      getManifest: async () => manifest,
      query: async () => queryResult,
      resolve: async () => resolvedReference,
    },
    ...overrides,
  } as ToolDeps;
}
