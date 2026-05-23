import { createWcProviderApp } from './app';
import { loadWcProviderConfig } from './config';

const cfg = loadWcProviderConfig();
const app = (await createWcProviderApp({ cfg })).listen(cfg.WC_PROVIDER_PORT);

console.log(
  `[woocommerce-provider-app] listening on http://localhost:${app.server?.port ?? cfg.WC_PROVIDER_PORT}`,
  `mock=${cfg.WC_PROVIDER_MOCK}`,
  `provider=${cfg.WC_PROVIDER_ID}`,
  `catalog=${cfg.WC_PROVIDER_CATALOG_BASE_URL}/ocp`,
);
