import type { AlimamaConfig } from '../config';

const SOURCE_ID = 'alimama_taobao_union';

export function sourceId() {
  return SOURCE_ID;
}

export function buildWellKnownDiscovery(cfg: AlimamaConfig) {
  const baseUrl = cfg.ALIMAMA_CATALOG_PUBLIC_BASE_URL.replace(/\/$/, '');
  return {
    ocp_version: '1.0',
    kind: 'WellKnownCatalogDiscovery',
    catalog_id: cfg.ALIMAMA_CATALOG_ID,
    catalog_name: cfg.ALIMAMA_CATALOG_NAME,
    manifest_url: `${baseUrl}/ocp/manifest`,
    health_url: `${baseUrl}/ocp/health`,
    query_url: `${baseUrl}/ocp/query`,
    resolve_url: `${baseUrl}/ocp/resolve`,
    contracts_url: `${baseUrl}/ocp/contracts`,
  };
}

export function buildCatalogManifest(cfg: AlimamaConfig) {
  const baseUrl = cfg.ALIMAMA_CATALOG_PUBLIC_BASE_URL.replace(/\/$/, '');
  return {
    ocp_version: '1.0',
    kind: 'CatalogManifest',
    id: `manifest_${cfg.ALIMAMA_CATALOG_ID}`,
    catalog_id: cfg.ALIMAMA_CATALOG_ID,
    catalog_name: cfg.ALIMAMA_CATALOG_NAME,
    description: 'Real-time affiliate catalog backed by Alimama/Taobao Union APIs. It queries upstream material APIs on demand and resolves selected entries into PID-attributed purchase actions.',
    registry_visibility: 'public',
    endpoints: {
      health: { url: `${baseUrl}/ocp/health`, method: 'GET' },
      query: { url: `${baseUrl}/ocp/query`, method: 'POST' },
      resolve: { url: `${baseUrl}/ocp/resolve`, method: 'POST' },
      contracts: { url: `${baseUrl}/ocp/contracts`, method: 'GET' },
    },
    query_capabilities: [
      {
        capability_id: 'ocp.affiliate.product.search.v1',
        name: 'Affiliate product search',
        description: 'Search real-time promotional products from affiliate networks.',
        query_packs: [
          {
            pack_id: 'ocp.query.keyword.v1',
            description: 'Keyword search against upstream affiliate material APIs.',
            query_modes: ['keyword'] as const,
          },
          {
            pack_id: 'ocp.query.filter.v1',
            description: 'Filter by category, platform, price, coupon, and source metadata.',
            query_modes: ['filter'] as const,
          },
        ],
        searchable_field_refs: [
          'affiliate.product#/title',
          'affiliate.product#/shop_title',
          'affiliate.product#/category',
        ],
        filterable_field_refs: [
          'affiliate.product#/category',
          'affiliate.product#/platform',
          'affiliate.offer#/has_coupon',
          'affiliate.price#/amount',
        ],
        input_fields: [
          {
            name: 'query',
            type: 'string',
            required: false,
            description: 'Keyword sent to the affiliate material search API.',
          },
          {
            name: 'category',
            type: 'string',
            required: false,
            description: 'Affiliate platform category id.',
          },
        ],
        supports_explain: true,
        supports_resolve: true,
        metadata: {
          source_id: SOURCE_ID,
          source_type: 'affiliate_network',
          realtime: true,
          persistent_product_storage: false,
        },
      },
    ],
    object_contracts: [],
    federation: {
      upstream_catalogs: [],
      routing_strategy: 'single_source',
      delegated_resolution: true,
      fallback_policy: 'return_empty_result',
      provenance_required: true,
    },
  };
}

export function buildCatalogHealth(cfg: AlimamaConfig) {
  return {
    ocp_version: '1.0',
    kind: 'CatalogHealth',
    catalog_id: cfg.ALIMAMA_CATALOG_ID,
    status: 'healthy',
    ready: true,
    checked_at: new Date().toISOString(),
    manifest_version: `manifest_${cfg.ALIMAMA_CATALOG_ID}`,
    details: {
      source_id: SOURCE_ID,
      mock_mode: cfg.ALIMAMA_MOCK,
      realtime_query: true,
      persistent_product_storage: false,
    },
    dependencies: [
      {
        name: 'alimama_api',
        status: 'healthy',
        message: cfg.ALIMAMA_MOCK ? 'Using local fixtures.' : 'External Alimama API credentials configured.',
      },
    ],
  };
}
