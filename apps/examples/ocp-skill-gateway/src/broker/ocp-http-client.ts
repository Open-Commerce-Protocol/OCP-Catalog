/**
 * OcpHttpBrokerClient
 *
 * 把 OCP 注册中心 + catalog 节点的「纯 HTTP REST」工作流包装成 BrokerClient 接口,
 * 完全不经过 MCP。底层用 `@ocp-catalog/ocp-client`(也是 OCP CLI / ocp-catalog skill 用的同一套客户端)。
 *
 * 对应 apps/ocp-site-web/src/content/docs/cli-and-skill.md 描述的标准 agent 流程:
 *   注册中心 search → 各 catalog 直连 /ocp/query → 选中的 entry 走 /ocp/resolve
 *
 * 工具映射(与 OcpMcpBrokerClient 一一对应,只是把 MCP tools/call 换成 REST):
 *   fanoutSearch  → searchCatalogs(列健康 catalog,60s 缓存)+ 并行 queryCatalog(route_hint.query_url)
 *   resolve       → resolveCatalogEntry(route_hint.resolve_url)
 *   pingCatalogs  → searchCatalogs(同上,顺便回填 cached catalogs)
 *
 * 与 MCP 模式的两点关键差异:
 *   1. 出网范围:gateway 要能直接访问各 catalog 节点的域名(如 alimama.clawdshop.cn),
 *      而不只是注册中心一个域名(MCP 模式下 query 由 MCP server 服务端代理)。
 *   2. resolve 字段:直连 catalog 节点返回的是 OCP 规范的 `action_bindings`(不是 MCP server
 *      重塑出来的 `actions`),所以这里直接吃 OcpClient 解析出的 action_bindings。
 */
import { OcpClient } from '@ocp-catalog/ocp-client';
import type { CatalogQueryRequest, ResolveRequest } from '@ocp-catalog/ocp-schema';
import type { CatalogSearchResult } from '@ocp-catalog/registration-schema';
import type { SkillGatewayConfig } from '../config';
import {
  type BrokerClient,
  type CatalogEntry,
  type FanoutSearchResult,
  type PingResult,
  type ResolveResult,
  type SearchHit,
  normalizeEntry,
} from './client';
import { selectSearchQueryPolicy } from './query-pack';

/** search 结果里我们实际用到的字段(route_hint 携带 query_url / resolve_url 用于直连)。 */
type RegisteredCatalog = CatalogSearchResult['items'][number];

const CATALOG_CACHE_TTL_MS = 60_000;
export class OcpHttpBrokerClient implements BrokerClient {
  private readonly client: OcpClient;
  /** 注册中心 base url,searchCatalogs 会在其后拼 `/ocp/catalogs/search`。 */
  private readonly registrationBaseUrl: string;
  /** 缓存 searchCatalogs 结果 60s,避免每次 skill 调用都重新发现一遍(与 MCP 版同款策略)。 */
  private catalogCache: { at: number; list: RegisteredCatalog[] } | null = null;

  constructor(private readonly cfg: SkillGatewayConfig) {
    this.registrationBaseUrl = cfg.SKILL_GATEWAY_OCP_REGISTRATION_URL;
    this.client = new OcpClient({
      timeoutMs: cfg.SKILL_GATEWAY_FANOUT_TIMEOUT_MS,
      userAgent: 'ocp-skill-gateway/0.1.0',
    });
  }

  /** 返回最近一次成功 list 出的 catalog 列表(供 dashboard 用)。 */
  get catalogs(): CatalogEntry[] {
    return (this.catalogCache?.list ?? []).map((c) => ({
      id: c.catalog_id,
      name: c.catalog_name,
      base_url: c.route_hint.query_url,
    }));
  }

  /** 列已注册的健康 catalog。带 60s 缓存。 */
  private async listHealthyCatalogs(): Promise<RegisteredCatalog[]> {
    if (this.catalogCache && Date.now() - this.catalogCache.at < CATALOG_CACHE_TTL_MS) {
      return this.catalogCache.list;
    }
    const result = await this.client.searchCatalogs(this.registrationBaseUrl, {
      ocp_version: '1.0',
      kind: 'CatalogSearchRequest',
      query: '',
      filters: {},
      limit: 20,
      explain: false,
    });
    // 只保留健康节点;其余 catalog 即使列出来也查不到东西
    const healthy = result.items.filter((c) => c.health_status === 'healthy');
    this.catalogCache = { at: Date.now(), list: healthy };
    return healthy;
  }

  async fanoutSearch(opts: {
    query: string;
    page?: number;
    page_size?: number;
  }): Promise<FanoutSearchResult> {
    const limit = opts.page_size ?? 10;
    if ((opts.page ?? 1) !== 1) {
      throw new Error('Only the first search page is supported until cursor pagination is available');
    }

    let catalogs: RegisteredCatalog[];
    try {
      catalogs = await this.listHealthyCatalogs();
    } catch (e) {
      return {
        hits: [],
        per_catalog: [
          {
            catalog_id: 'ocp_registry',
            catalog_name: 'OCP Registry (HTTP)',
            ok: false,
            count: 0,
            error: `searchCatalogs failed: ${e instanceof Error ? e.message : String(e)}`,
            elapsed_ms: 0,
          },
        ],
      };
    }

    const calls = catalogs.map((c) => this.queryOne(c, opts.query, limit));
    const settled = await Promise.allSettled(calls);
    const hits: SearchHit[] = [];
    const per_catalog: FanoutSearchResult['per_catalog'] = [];
    for (let i = 0; i < settled.length; i++) {
      const cat = catalogs[i]!;
      const r = settled[i]!;
      if (r.status === 'fulfilled') {
        hits.push(...r.value.hits);
        per_catalog.push({
          catalog_id: cat.catalog_id,
          catalog_name: cat.catalog_name,
          ok: true,
          count: r.value.hits.length,
          elapsed_ms: r.value.elapsed_ms,
        });
      } else {
        per_catalog.push({
          catalog_id: cat.catalog_id,
          catalog_name: cat.catalog_name,
          ok: false,
          count: 0,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
          elapsed_ms: 0,
        });
      }
    }
    return { hits, per_catalog };
  }

  private async queryOne(
    cat: RegisteredCatalog,
    query: string,
    limit: number,
  ): Promise<{ hits: SearchHit[]; elapsed_ms: number }> {
    const t0 = Date.now();
    const queryPolicy = selectSearchQueryPolicy({
      query,
      supportedQueryPacks: cat.route_hint.supported_query_packs,
    });
    const body: CatalogQueryRequest = {
      ocp_version: '1.0',
      kind: 'CatalogQueryRequest',
      catalog_id: cat.catalog_id,
      // 只发送 catalog 明确声明的 query_pack;semantic 优先以触发向量检索。
      ...(queryPolicy ? { query_pack: queryPolicy.queryPack } : {}),
      ...(queryPolicy?.queryMode ? { query_mode: queryPolicy.queryMode } : {}),
      query,
      filters: {},
      limit,
      offset: 0,
      explain: false,
    };
    const result = await this.client.queryCatalog(cat.route_hint.query_url, body);
    const hits = result.entries.map((match) =>
      normalizeEntry(result.catalog_id ?? cat.catalog_id, cat.catalog_name, match.entry),
    );
    return { hits, elapsed_ms: Date.now() - t0 };
  }

  async resolve(opts: {
    catalog_id: string;
    entry_ref: string;
    sub_id?: string;
  }): Promise<ResolveResult> {
    // resolve 需要目标 catalog 的 resolve_url,从缓存的 search 结果里取;缓存未命中则刷新一次。
    let cat = this.findCachedCatalog(opts.catalog_id);
    if (!cat) {
      try {
        await this.listHealthyCatalogs();
      } catch {
        // 忽略:下面会以 unknown catalog 返回
      }
      cat = this.findCachedCatalog(opts.catalog_id);
    }
    if (!cat) {
      return { catalog_id: opts.catalog_id, error: `unknown catalog_id: ${opts.catalog_id}` };
    }
    const resolveUrl = cat.route_hint.resolve_url;
    if (!resolveUrl) {
      return { catalog_id: opts.catalog_id, error: `catalog ${opts.catalog_id} 未声明 resolve_url` };
    }

    try {
      const body: ResolveRequest = {
        ocp_version: '1.0',
        kind: 'ResolveRequest',
        catalog_id: opts.catalog_id,
        entry_id: opts.entry_ref,
        purpose: 'checkout',
        live_check: true,
        // sub_id 透传放 requested_fields,跟其它 broker 保持一致的约定。
        requested_fields: opts.sub_id ? [`sub_id:${opts.sub_id}`] : [],
      };
      const ref = await this.client.resolveCatalogEntry(resolveUrl, body);
      // 直连 catalog 节点返回 OCP 规范的 action_bindings。优先 buy_now,其次任意 url 类型 action。
      const bindings = ref.action_bindings ?? [];
      const urlBinding =
        bindings.find((b) => b.action_id === 'buy_now' && b.entrypoint?.url) ??
        bindings.find((b) => b.action_type === 'url' && b.entrypoint?.url);
      const shortBinding = bindings.find((b) => /short/i.test(b.label ?? '') && b.entrypoint?.url);
      return {
        catalog_id: opts.catalog_id,
        deeplink_url: urlBinding?.entrypoint?.url,
        short_url: shortBinding?.entrypoint?.url,
        raw: ref,
      };
    } catch (e) {
      return {
        catalog_id: opts.catalog_id,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  async pingCatalogs(): Promise<PingResult[]> {
    const t0 = Date.now();
    try {
      // 强制刷新一次注册中心,不读缓存
      this.catalogCache = null;
      const list = await this.listHealthyCatalogs();
      const elapsed = Date.now() - t0;
      return list.map((c) => ({
        id: c.catalog_id,
        name: c.catalog_name,
        base_url: c.route_hint.query_url,
        ok: c.health_status === 'healthy',
        latency_ms: elapsed,
      }));
    } catch (e) {
      return [
        {
          id: 'ocp_registry',
          name: 'OCP Registry (HTTP)',
          base_url: this.registrationBaseUrl,
          ok: false,
          latency_ms: Date.now() - t0,
          error: e instanceof Error ? e.message : String(e),
        },
      ];
    }
  }

  private findCachedCatalog(catalogId: string): RegisteredCatalog | undefined {
    return this.catalogCache?.list.find((c) => c.catalog_id === catalogId);
  }
}
