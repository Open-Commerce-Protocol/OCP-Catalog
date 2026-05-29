/**
 * PDD Duoduojinbao affiliate Catalog Node entrypoint.
 *
 * 与 alimama / JD catalog-api 同结构:把 PDD 多多客建模为一个 OCP Catalog Node,
 * query/resolve 实时打上游,不接受 Provider 入库,不在 Catalog 持久化商品。
 */
import { PddClient } from './pdd/client';
import { createPddCatalogApp } from './app';
import { loadPddConfig } from './config';
import { CommissionLedger } from './services/commission-ledger';
import { startOrderPoller } from './workers/order-poller';

const cfg = loadPddConfig();
const pdd = new PddClient(cfg);
const ledger = new CommissionLedger();

const app = createPddCatalogApp({ pdd, ledger, cfg }).listen(cfg.PDD_CATALOG_PORT);

console.log(
  `[pdd-catalog-api] listening on http://localhost:${app.server?.port ?? cfg.PDD_CATALOG_PORT}, mock=${cfg.PDD_MOCK}, custom_params=${cfg.PDD_CUSTOM_PARAMS_MODE}`,
);

startOrderPoller({ pdd, ledger, cfg });
