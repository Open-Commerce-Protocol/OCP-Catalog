/**
 * Alimama affiliate Catalog Node entrypoint.
 *
 * The example models an affiliate/commission platform as a queryable,
 * resolvable OCP Catalog Node. It does not register as a Provider and does
 * not persist upstream products before query; it forwards query/resolve calls
 * to Alimama/Taobao Union APIs in real time.
 */
import { AlimamaClient } from './alimama/client';
import { createAlimamaCatalogApp } from './app';
import { loadAlimamaConfig } from './config';
import { CommissionLedger } from './services/commission-ledger';
import { startOrderPoller } from './workers/order-poller';

const cfg = loadAlimamaConfig();
const alimama = new AlimamaClient(cfg);
const ledger = new CommissionLedger();

const app = createAlimamaCatalogApp({ alimama, ledger, cfg }).listen(cfg.ALIMAMA_CATALOG_PORT);

console.log(
  `[alimama-catalog-api] listening on http://localhost:${app.server?.port ?? cfg.ALIMAMA_CATALOG_PORT}, mock=${cfg.ALIMAMA_MOCK}`,
);

startOrderPoller({ alimama, ledger, cfg });
