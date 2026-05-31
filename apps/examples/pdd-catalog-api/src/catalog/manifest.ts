import type { PddConfig } from '../config';

/**
 * 这个 Catalog Node 在 OCP 协议层的身份标识。
 * 也用作 CommercialObject.provider_id 与 entry_id 前缀的来源。
 */
const SOURCE_ID = 'pdd';

export function sourceId() {
  return SOURCE_ID;
}

export function buildWellKnownDiscovery(cfg: PddConfig) {
  const baseUrl = cfg.PDD_CATALOG_PUBLIC_BASE_URL.replace(/\/$/, '');
  return {
    ocp_version: '1.0',
    kind: 'WellKnownCatalogDiscovery',
    catalog_id: cfg.PDD_CATALOG_ID,
    catalog_name: cfg.PDD_CATALOG_NAME,
    manifest_url: `${baseUrl}/ocp/manifest`,
    health_url: `${baseUrl}/ocp/health`,
    query_url: `${baseUrl}/ocp/query`,
    resolve_url: `${baseUrl}/ocp/resolve`,
    contracts_url: `${baseUrl}/ocp/contracts`,
  };
}

export function buildCatalogManifest(cfg: PddConfig) {
  const baseUrl = cfg.PDD_CATALOG_PUBLIC_BASE_URL.replace(/\/$/, '');
  return {
    ocp_version: '1.0',
    kind: 'CatalogManifest',
    id: `manifest_${cfg.PDD_CATALOG_ID}`,
    catalog_id: cfg.PDD_CATALOG_ID,
    catalog_name: cfg.PDD_CATALOG_NAME,
    description:
      'Real-time affiliate catalog backed by PDD Duoduojinbao (拼多多多多客) APIs. Queries upstream goods APIs on demand and resolves selected entries into PID-attributed purchase actions via p.pinduoduo.com short links, with optional WeChat / QQ mini-program webview entries.',
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
        name: 'PDD Duoduojinbao affiliate product search',
        description: 'Search real-time promotional products from PDD Duoduojinbao.',
        query_packs: [
          {
            pack_id: 'ocp.query.keyword.v1',
            description: 'Keyword search against pdd.ddk.goods.search.',
            query_modes: ['keyword'],
          },
          {
            pack_id: 'ocp.query.filter.v1',
            description:
              'Filter by category, merchant type, price, coupon, and source metadata.',
            query_modes: ['filter'],
          },
        ],
        searchable_field_refs: [
          'affiliate.product#/title',
          'affiliate.product#/brand',
          'affiliate.product#/category',
        ],
        filterable_field_refs: [
          'affiliate.product#/category',
          'affiliate.product#/platform',
          'affiliate.product#/pdd_merchant_type',
          'affiliate.offer#/has_coupon',
          'affiliate.price#/amount',
        ],
        input_fields: [
          {
            name: 'query',
            type: 'string',
            required: false,
            description: 'Keyword sent to pdd.ddk.goods.search.',
          },
          {
            name: 'category',
            type: 'string',
            required: false,
            description: 'PDD category id (cat_id number as string).',
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

export function buildCatalogHealth(cfg: PddConfig) {
  return {
    ocp_version: '1.0',
    kind: 'CatalogHealth',
    catalog_id: cfg.PDD_CATALOG_ID,
    status: 'healthy',
    ready: true,
    checked_at: new Date().toISOString(),
    manifest_version: `manifest_${cfg.PDD_CATALOG_ID}`,
    details: {
      source_id: SOURCE_ID,
      mock_mode: cfg.PDD_MOCK,
      realtime_query: true,
      persistent_product_storage: false,
      custom_params_mode: cfg.PDD_CUSTOM_PARAMS_MODE,
    },
    dependencies: [
      {
        name: 'pdd_api',
        status: 'healthy',
        message: cfg.PDD_MOCK
          ? 'Using local fixtures.'
          : 'External PDD Duoduojinbao API credentials configured.',
      },
    ],
  };
}
