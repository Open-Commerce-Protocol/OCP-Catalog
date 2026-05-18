/**
 * Shopify Catalog (OCP bridge) entrypoint.
 *
 * Real-time, no-DB OCP Catalog Node backed by the Shopify Catalog MCP
 * endpoints (Global or Storefront). Forwards /ocp/query → search_catalog
 * and /ocp/resolve → get_product; emits OCP-shaped responses.
 */
import { createShopifyCatalogApp } from './app';
import { loadShopifyConfig } from './config';
import { ShopifyCatalogClient } from './shopify/mcp-client';

const cfg = loadShopifyConfig();
const shopify = new ShopifyCatalogClient(cfg);

const app = createShopifyCatalogApp({ shopify, cfg }).listen(cfg.SHOPIFY_CATALOG_PORT);

console.log(
  `[shopify-catalog-api] listening on http://localhost:${app.server?.port ?? cfg.SHOPIFY_CATALOG_PORT}`,
  `mode=${cfg.SHOPIFY_CATALOG_MODE}`,
  `mock=${cfg.SHOPIFY_MOCK}`,
  `endpoint=${cfg.SHOPIFY_RESOLVED_ENDPOINT}`,
);
