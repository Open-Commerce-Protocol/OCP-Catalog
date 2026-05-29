/**
 * Shopify Public App (App Store form) entrypoint.
 *
 * Multi-tenant: one process serves every installed merchant. OAuth install
 * stores a per-shop token; product webhooks + scheduled delta sync push each
 * shop's catalogue into the OCP Catalog as that shop's Provider.
 */
import { createShopifyApp } from './app';
import { loadShopifyAppConfig } from './config';

const cfg = loadShopifyAppConfig();
const app = (await createShopifyApp({ cfg })).listen(cfg.SHOPIFY_APP_PORT);

console.log(
  `[shopify-app] listening on http://localhost:${app.server?.port ?? cfg.SHOPIFY_APP_PORT}`,
  `mock=${cfg.SHOPIFY_APP_MOCK}`,
  `app_url=${cfg.SHOPIFY_APP_URL}`,
  `catalog=${cfg.SHOPIFY_APP_CATALOG_BASE_URL}/ocp`,
);
