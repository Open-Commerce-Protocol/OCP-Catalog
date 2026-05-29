/**
 * Broker 抽象层。
 *
 * 上游有两种来源,routes 不感知:
 *   - LocalCatalogsBrokerClient: 走配置的 OCP Catalog Node HTTP(本地 mock 联调)
 *   - OcpMcpBrokerClient:        走 ocp.deeplumen.io/mcp 注册中心(线上真实数据)
 *
 * routes 只依赖 `BrokerClient` 接口 + 共享 DTO,具体实现由 app.ts 按 env 选。
 */
import type { SkillGatewayConfig } from '../config';

export interface CatalogEntry {
  id: string;
  name: string;
  base_url: string;
}

export interface SearchHit {
  catalog_id: string;
  catalog_name: string;
  title: string;
  price?: number;
  currency?: string;
  image_url?: string;
  detail_url?: string;
  /** OCP 内部 entry token,resolve 时透传给对应 catalog */
  entry_ref?: string;
  /** 透传给上层用的原始字段,LLM 一般用不到 */
  raw?: unknown;
}

export interface FanoutSearchResult {
  hits: SearchHit[];
  per_catalog: Array<{
    catalog_id: string;
    catalog_name: string;
    ok: boolean;
    count: number;
    error?: string;
    elapsed_ms: number;
  }>;
}

export interface ResolveResult {
  catalog_id: string;
  deeplink_url?: string;
  short_url?: string;
  raw?: unknown;
  error?: string;
}

export interface PingResult {
  id: string;
  name: string;
  base_url: string;
  ok: boolean;
  latency_ms: number;
  error?: string;
}

export interface BrokerClient {
  readonly catalogs: CatalogEntry[];
  fanoutSearch(opts: { query: string; page?: number; page_size?: number }): Promise<FanoutSearchResult>;
  resolve(opts: { catalog_id: string; entry_ref: string; sub_id?: string }): Promise<ResolveResult>;
  pingCatalogs(): Promise<PingResult[]>;
}

/**
 * 从 OCP CatalogEntry 的 attributes 抽扁平字段。两种 broker 拿到的 entry 结构一致,
 * 因为 ocp.deeplumen.io 的 MCP server 内部也是用的 OCP CatalogEntry。
 */
export function normalizeEntry(
  catalogId: string,
  catalogName: string,
  item: any,
): SearchHit {
  const attrs = item?.attributes ?? {};
  const priceDescriptor = attrs?.price ?? {};
  const price =
    typeof priceDescriptor?.amount === 'number'
      ? priceDescriptor.amount
      : typeof priceDescriptor?.amount === 'string'
        ? Number(priceDescriptor.amount)
        : undefined;
  const imageUrls = attrs?.image_urls;
  return {
    catalog_id: catalogId,
    catalog_name: catalogName,
    title: item?.title ?? attrs?.title ?? '(无标题)',
    price,
    currency: priceDescriptor?.currency ?? 'CNY',
    image_url: Array.isArray(imageUrls) ? imageUrls[0] : attrs?.image_url,
    detail_url: attrs?.product_url ?? attrs?.detail_url,
    entry_ref: item?.entry_id ?? item?.object_id,
    raw: item,
  };
}

/**
 * 本地 mock 联调用的 broker:并行调用所有已配置 catalog 的 /ocp/query。
 * 失败的 catalog 不会让整个请求挂掉,会记录到 per_catalog 里。
 */
export class LocalCatalogsBrokerClient implements BrokerClient {
  constructor(private readonly cfg: SkillGatewayConfig) {}

  get catalogs(): CatalogEntry[] {
    return this.cfg.SKILL_GATEWAY_CATALOGS;
  }

  async fanoutSearch(opts: {
    query: string;
    page?: number;
    page_size?: number;
  }): Promise<FanoutSearchResult> {
    const calls = this.catalogs.map((c) => this.searchOne(c, opts));
    const settled = await Promise.allSettled(calls);
    const hits: SearchHit[] = [];
    const per_catalog: FanoutSearchResult['per_catalog'] = [];
    for (let i = 0; i < settled.length; i++) {
      const cat = this.catalogs[i]!;
      const r = settled[i]!;
      if (r.status === 'fulfilled') {
        hits.push(...r.value.hits);
        per_catalog.push({
          catalog_id: cat.id,
          catalog_name: cat.name,
          ok: true,
          count: r.value.hits.length,
          elapsed_ms: r.value.elapsed_ms,
        });
      } else {
        per_catalog.push({
          catalog_id: cat.id,
          catalog_name: cat.name,
          ok: false,
          count: 0,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
          elapsed_ms: 0,
        });
      }
    }
    return { hits, per_catalog };
  }

  private async searchOne(
    cat: CatalogEntry,
    opts: { query: string; page?: number; page_size?: number },
  ): Promise<{ hits: SearchHit[]; elapsed_ms: number }> {
    const t0 = Date.now();
    const limit = opts.page_size ?? 10;
    const offset = ((opts.page ?? 1) - 1) * limit;
    const body = {
      ocp_version: '1.0',
      kind: 'CatalogQueryRequest',
      query: opts.query,
      limit,
      offset,
      filters: {},
      explain: false,
    };
    const res = await fetch(`${cat.base_url}/ocp/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.cfg.SKILL_GATEWAY_FANOUT_TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`catalog ${cat.id} responded ${res.status}: ${detail.slice(0, 200)}`);
    }
    const json: any = await res.json();
    const items: any[] = Array.isArray(json?.items) ? json.items : [];
    const hits = items.map((it) => normalizeEntry(cat.id, cat.name, it));
    return { hits, elapsed_ms: Date.now() - t0 };
  }

  async resolve(opts: {
    catalog_id: string;
    entry_ref: string;
    sub_id?: string;
  }): Promise<ResolveResult> {
    const cat = this.catalogs.find((c) => c.id === opts.catalog_id);
    if (!cat) {
      return { catalog_id: opts.catalog_id, error: `unknown catalog_id: ${opts.catalog_id}` };
    }
    const body = {
      ocp_version: '1.0',
      kind: 'ResolveRequest',
      entry_id: opts.entry_ref,
      purpose: 'checkout' as const,
      live_check: true,
      requested_fields: opts.sub_id ? [`sub_id:${opts.sub_id}`] : [],
    };
    try {
      const res = await fetch(`${cat.base_url}/ocp/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.cfg.SKILL_GATEWAY_FANOUT_TIMEOUT_MS),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        return { catalog_id: cat.id, error: `catalog responded ${res.status}: ${detail.slice(0, 200)}` };
      }
      const json: any = await res.json();
      const bindings: any[] = Array.isArray(json?.action_bindings) ? json.action_bindings : [];
      const urlBinding = bindings.find((b) => b?.action_type === 'url' && b?.entrypoint?.url);
      const shortBinding = bindings.find((b) => /short/i.test(b?.label ?? '') && b?.entrypoint?.url);
      return {
        catalog_id: cat.id,
        deeplink_url: urlBinding?.entrypoint?.url,
        short_url: shortBinding?.entrypoint?.url,
        raw: json,
      };
    } catch (e) {
      return {
        catalog_id: cat.id,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  async pingCatalogs(): Promise<PingResult[]> {
    return Promise.all(
      this.catalogs.map(async (c) => {
        const t0 = Date.now();
        try {
          const res = await fetch(`${c.base_url}/health`, {
            signal: AbortSignal.timeout(2000),
          });
          return {
            id: c.id,
            name: c.name,
            base_url: c.base_url,
            ok: res.ok,
            latency_ms: Date.now() - t0,
          };
        } catch (e) {
          return {
            id: c.id,
            name: c.name,
            base_url: c.base_url,
            ok: false,
            latency_ms: Date.now() - t0,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      }),
    );
  }
}
