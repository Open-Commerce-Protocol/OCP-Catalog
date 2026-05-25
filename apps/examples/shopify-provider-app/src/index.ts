/**
 * Shopify OCP Provider App entrypoint.
 *
 * Treats a Shopify merchant store as an OCP Provider: pulls products via
 * Admin GraphQL, maps to OCP CommercialObject, pushes to an OCP Catalog
 * via /ocp/providers/register and /ocp/objects/sync.
 */
import { createShopifyProviderApp } from './app';
import { loadShopifyProviderConfig } from './config';

const cfg = loadShopifyProviderConfig();
const app = (await createShopifyProviderApp({ cfg })).listen(cfg.SHOPIFY_PROVIDER_PORT);

console.log(
  `[shopify-provider-app] listening on http://localhost:${app.server?.port ?? cfg.SHOPIFY_PROVIDER_PORT}`,
  `mock=${cfg.SHOPIFY_PROVIDER_MOCK}`,
  `provider=${cfg.SHOPIFY_PROVIDER_ID}`,
  `catalog=${cfg.SHOPIFY_PROVIDER_CATALOG_BASE_URL}/ocp`,
);
