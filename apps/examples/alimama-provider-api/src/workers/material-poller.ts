/**
 * Material Poller: 定时拉 alimama 物料 → 推到 OCP catalog。
 *
 * 与 /admin/sync 端点共享底层逻辑(syncMaterialOnce)。
 *
 * 间隔由 MATERIAL_POLL_INTERVAL_SEC 控制,0 表示不启用。
 * 启动时延迟 3 秒先跑一次,之后按 interval 周期跑。
 */
import type { AlimamaClient } from '../alimama/client';
import type { AlimamaConfig } from '../config';
import { mapMaterialToCommercialObject } from '../mapper/material-to-object';
import type { OcpCatalogClient } from '../services/catalog-client';

export interface MaterialPollerDeps {
  alimama: AlimamaClient;
  catalog: OcpCatalogClient;
  cfg: AlimamaConfig;
}

export interface MaterialSyncResult {
  total: number;
  batches: number;
  acceptedCount: number;
  rejectedCount: number;
}

const BATCH_SIZE = 100;

/** 共享的核心同步逻辑(被 /admin/sync 和 cron 都复用) */
export async function syncMaterialOnce(
  deps: MaterialPollerDeps,
  opts: { q?: string; pageSize?: number; registrationVersion?: number } = {},
): Promise<MaterialSyncResult> {
  const q = opts.q ?? deps.cfg.MATERIAL_POLL_QUERY;
  const pageSize = opts.pageSize ?? deps.cfg.MATERIAL_POLL_PAGE_SIZE;
  const registrationVersion = opts.registrationVersion ?? 1;

  const mat = await deps.alimama.listMaterial({ q, pageNo: 1, pageSize });
  const items = mat.tbk_dg_material_optional_response?.result_list?.map_data ?? [];

  if (items.length === 0) {
    return { total: 0, batches: 0, acceptedCount: 0, rejectedCount: 0 };
  }

  const mapperCtx = {
    providerId: deps.cfg.OCP_PROVIDER_ID,
    providerBaseUrl: deps.cfg.OCP_PROVIDER_BASE_URL,
  };
  const objects = items.map((i) => mapMaterialToCommercialObject(i, mapperCtx));

  let acceptedCount = 0;
  let rejectedCount = 0;
  let batches = 0;
  for (let i = 0; i < objects.length; i += BATCH_SIZE) {
    const batch = objects.slice(i, i + BATCH_SIZE);
    const res = (await deps.catalog.syncObjects({
      ocp_version: '1.0',
      kind: 'ObjectSyncRequest',
      catalog_id: deps.cfg.OCP_CATALOG_ID,
      provider_id: deps.cfg.OCP_PROVIDER_ID,
      registration_version: registrationVersion,
      batch_id: `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      objects: batch,
    })) as { accepted_count?: number; rejected_count?: number };
    acceptedCount += res.accepted_count ?? 0;
    rejectedCount += res.rejected_count ?? 0;
    batches++;
  }

  return { total: objects.length, batches, acceptedCount, rejectedCount };
}

export function startMaterialPoller(deps: MaterialPollerDeps): { stop: () => void } {
  const intervalSec = deps.cfg.MATERIAL_POLL_INTERVAL_SEC;
  if (intervalSec <= 0) {
    return { stop: () => {} };
  }

  const tick = async () => {
    try {
      const r = await syncMaterialOnce(deps);
      console.log(
        `[material-poller] synced ${r.total} items, ${r.acceptedCount} accepted, ${r.rejectedCount} rejected`,
      );
    } catch (err) {
      console.warn(
        `[material-poller] sync failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  };

  const kickoff = setTimeout(tick, 3000);
  const handle = setInterval(tick, intervalSec * 1000);
  console.log(`[material-poller] started, interval=${intervalSec}s`);

  return {
    stop: () => {
      clearTimeout(kickoff);
      clearInterval(handle);
    },
  };
}
