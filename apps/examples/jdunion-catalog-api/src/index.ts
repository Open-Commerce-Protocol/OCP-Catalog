/**
 * JD Union affiliate Catalog Node entrypoint.
 *
 * 与 alimama-catalog-api 同结构:把 JD 联盟建模为一个 OCP Catalog Node,
 * query/resolve 实时打上游,不接受 Provider 入库,不在 Catalog 持久化商品。
 */
import { JdUnionClient } from './jd/client';
import { createJdUnionCatalogApp } from './app';
import { loadJdUnionConfig } from './config';
import { CommissionLedger } from './services/commission-ledger';
import { startOrderPoller } from './workers/order-poller';

const cfg = loadJdUnionConfig();
const jd = new JdUnionClient(cfg);
const ledger = new CommissionLedger();

const app = createJdUnionCatalogApp({ jd, ledger, cfg }).listen(
  cfg.JDUNION_CATALOG_PORT,
);

console.log(
  `[jdunion-catalog-api] listening on http://localhost:${app.server?.port ?? cfg.JDUNION_CATALOG_PORT}, mock=${cfg.JDUNION_MOCK}, strategy=${cfg.JDUNION_RESOLVE_STRATEGY}`,
);

startOrderPoller({ jd, ledger, cfg });
