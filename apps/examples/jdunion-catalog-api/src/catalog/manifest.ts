import type { JdUnionConfig } from '../config';

/**
 * 这个 Catalog Node 在 OCP 协议层的身份标识。
 * 也用作 CommercialObject.provider_id 与 entry_id 前缀的来源。
 */
const SOURCE_ID = 'jdunion';

export function sourceId() {
  return SOURCE_ID;
}

export function buildWellKnownDiscovery(cfg: JdUnionConfig) {
  const baseUrl = cfg.JDUNION_CATALOG_PUBLIC_BASE_URL.replace(/\/$/, '');
  return {
    ocp_version: '1.0',
    kind: 'WellKnownCatalogDiscovery',
    catalog_id: cfg.JDUNION_CATALOG_ID,
    catalog_name: cfg.JDUNION_CATALOG_NAME,
    manifest_url: `${baseUrl}/ocp/manifest`,
    health_url: `${baseUrl}/ocp/health`,
    query_url: `${baseUrl}/ocp/query`,
    resolve_url: `${baseUrl}/ocp/resolve`,
    contracts_url: `${baseUrl}/ocp/contracts`,
  };
}

export function buildCatalogManifest(cfg: JdUnionConfig) {
  const baseUrl = cfg.JDUNION_CATALOG_PUBLIC_BASE_URL.replace(/\/$/, '');
  return {
    ocp_version: '1.0',
    kind: 'CatalogManifest',
    id: `manifest_${cfg.JDUNION_CATALOG_ID}`,
    catalog_id: cfg.JDUNION_CATALOG_ID,
    catalog_name: cfg.JDUNION_CATALOG_NAME,
    description:
      'Real-time affiliate catalog backed by JD Union (京东联盟) APIs. Queries upstream goods APIs on demand and resolves selected entries into PID-attributed purchase actions via u.jd.com short links.',
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
        name: 'JD Union affiliate product search',
        description: 'Search real-time promotional products from JD Union (京东联盟).',
        query_packs: [
          {
            pack_id: 'ocp.query.keyword.v1',
            description: 'Keyword search against jd.union.open.goods.query.',
            query_modes: ['keyword'],
          },
          {
            pack_id: 'ocp.query.filter.v1',
            description:
              'Filter by category, JD owner (self_operated / pop), price, coupon, and source metadata.',
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
          'affiliate.product#/jd_owner',
          'affiliate.offer#/has_coupon',
          'affiliate.price#/amount',
        ],
        input_fields: [
          {
            name: 'query',
            type: 'string',
            required: false,
            description: 'Keyword sent to JD goods.query.',
          },
          {
            name: 'category',
            type: 'string',
            required: false,
            description: 'JD category id (cid3 number as string).',
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
      mode: 'disabled' as const,
      node_role: 'source_catalog' as const,
    },
  };
}

export function buildCatalogHealth(cfg: JdUnionConfig) {
  return {
    ocp_version: '1.0',
    kind: 'CatalogHealth',
    catalog_id: cfg.JDUNION_CATALOG_ID,
    status: 'healthy',
    ready: true,
    checked_at: new Date().toISOString(),
    manifest_version: `manifest_${cfg.JDUNION_CATALOG_ID}`,
    details: {
      source_id: SOURCE_ID,
      mock_mode: cfg.JDUNION_MOCK,
      realtime_query: true,
      persistent_product_storage: false,
      resolve_strategy: cfg.JDUNION_RESOLVE_STRATEGY,
    },
    dependencies: [
      {
        name: 'jdunion_api',
        status: 'healthy',
        message: cfg.JDUNION_MOCK
          ? 'Using local fixtures.'
          : 'External JD Union API credentials configured.',
      },
    ],
  };
}
