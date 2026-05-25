import type { ShopifyConfig } from '../config';

export function sourceId(cfg: ShopifyConfig): string {
  return cfg.SHOPIFY_CATALOG_MODE === 'storefront'
    ? `shopify_storefront_${cfg.SHOPIFY_STORE_DOMAIN}`
    : 'shopify_global';
}

export function buildWellKnownDiscovery(cfg: ShopifyConfig) {
  const baseUrl = cfg.SHOPIFY_CATALOG_PUBLIC_BASE_URL.replace(/\/$/, '');
  return {
    ocp_version: '1.0',
    kind: 'WellKnownCatalogDiscovery',
    catalog_id: cfg.SHOPIFY_CATALOG_ID,
    catalog_name: cfg.SHOPIFY_CATALOG_NAME,
    manifest_url: `${baseUrl}/ocp/manifest`,
    health_url: `${baseUrl}/ocp/health`,
    query_url: `${baseUrl}/ocp/query`,
    resolve_url: `${baseUrl}/ocp/resolve`,
    contracts_url: `${baseUrl}/ocp/contracts`,
  };
}

export function buildCatalogManifest(cfg: ShopifyConfig) {
  const baseUrl = cfg.SHOPIFY_CATALOG_PUBLIC_BASE_URL.replace(/\/$/, '');
  const modeDescription =
    cfg.SHOPIFY_CATALOG_MODE === 'storefront'
      ? `Storefront-scoped to ${cfg.SHOPIFY_STORE_DOMAIN}.`
      : 'Global Shopify catalog spanning all participating merchants.';

  return {
    ocp_version: '1.0',
    kind: 'CatalogManifest',
    id: `manifest_${cfg.SHOPIFY_CATALOG_ID}`,
    catalog_id: cfg.SHOPIFY_CATALOG_ID,
    catalog_name: cfg.SHOPIFY_CATALOG_NAME,
    description: `Real-time OCP Catalog Node backed by the Shopify Catalog MCP. ${modeDescription} Products are not persisted; query and resolve calls are forwarded to Shopify and translated to OCP shapes.`,
    registry_visibility: 'public',
    endpoints: {
      health: { url: `${baseUrl}/ocp/health`, method: 'GET' },
      query: { url: `${baseUrl}/ocp/query`, method: 'POST' },
      resolve: { url: `${baseUrl}/ocp/resolve`, method: 'POST' },
      contracts: { url: `${baseUrl}/ocp/contracts`, method: 'GET' },
    },
    query_capabilities: [
      {
        capability_id: 'ocp.shopify.product.search.v1',
        name: 'Shopify product search',
        description:
          'Search Shopify Global / Storefront catalog in real time via the search_catalog MCP tool.',
        query_packs: [
          {
            pack_id: 'ocp.query.keyword.v1',
            description: 'Keyword search forwarded to Shopify search_catalog.',
            query_modes: ['keyword', 'filter'] as const,
          },
        ],
        supports_explain: true,
        supports_resolve: true,
        metadata: {
          accepted_filters: ['in_stock_only'],
          notes:
            cfg.SHOPIFY_CATALOG_MODE === 'global'
              ? 'Global Catalog also accepts a ships_to country, configured per node.'
              : 'Storefront Catalog does not expose ships_to filters.',
        },
      },
    ],
    // Required by catalogManifestSchema even when this node accepts no
    // provider ingestion (it's a real-time bridge to Shopify).
    object_contracts: [],
    // Intentionally no provider_contract / sync_capabilities / federation:
    // this catalog does not persist objects.
  };
}

export function buildCatalogHealth(cfg: ShopifyConfig) {
  return {
    ocp_version: '1.0',
    kind: 'CatalogHealth',
    catalog_id: cfg.SHOPIFY_CATALOG_ID,
    status: 'healthy' as const,
    ready: true,
    checked_at: new Date().toISOString(),
    details: {
      mode: cfg.SHOPIFY_CATALOG_MODE,
      mock: cfg.SHOPIFY_MOCK,
      endpoint: cfg.SHOPIFY_RESOLVED_ENDPOINT,
    },
    dependencies: [
      {
        name: 'shopify_catalog_mcp',
        status: 'healthy' as const,
        message: cfg.SHOPIFY_MOCK
          ? 'mock mode: fixture-backed, not calling upstream'
          : `forwarding to ${cfg.SHOPIFY_RESOLVED_ENDPOINT}`,
      },
    ],
  };
}

export function buildContracts(cfg: ShopifyConfig) {
  return {
    ocp_version: '1.0',
    kind: 'ObjectContractList',
    catalog_id: cfg.SHOPIFY_CATALOG_ID,
    object_contracts: [],
    note: 'This Catalog Node is a real-time Shopify bridge and does not accept provider object ingestion. See manifest.query_capabilities for the read paths it does expose.',
  };
}
