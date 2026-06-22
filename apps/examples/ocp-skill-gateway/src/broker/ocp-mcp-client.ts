/**
 * OcpMcpBrokerClient
 *
 * 把 ocp.deeplumen.io/mcp(OCP 注册中心 MCP server)的 6 个工具包装成 BrokerClient 接口。
 *
 * Coze / 元器 / 百炼 等平台只懂 OpenAPI HTTP,不懂 MCP。这层让 gateway 站在 MCP 客户端的位置,
 * 把 MCP server 的能力翻译成我们 5 个 skill 的 HTTP 契约,Coze 那边零变更。
 *
 * 工具映射:
 *   fanoutSearch  → search_catalogs(列健康 catalog,60s 缓存)+ 并行 query_catalog
 *   resolve       → resolve_catalog_entry
 *   pingCatalogs  → search_catalogs(同上,顺便回填 cached catalogs)
 *
 * 为什么不用 find_and_query_catalog?它是 server 端选 1 个最匹配 catalog 的"一站式"工具,
 * 但 keyword 匹配会因为 catalog 描述里有"Commerce product"字样把请求路到空的 cat_local_dev,
 * 跨电商联盟的多源覆盖就丢了。我们自己 fan-out 是必要的。
 */
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
import { routeSupportedQueryPacks, selectSearchQueryPolicy } from './query-pack';

interface McpJsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

interface McpToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

/** search_catalogs 返回的单条 catalog 描述,带 route_hint 用于后续 query 直连。 */
interface RegisteredCatalog {
  catalog_id: string;
  catalog_name: string;
  health_status?: string;
  query_url?: string;
  route_hint?: Record<string, unknown>;
}

const CATALOG_CACHE_TTL_MS = 60_000;

function requireToolArray<T>(
  toolName: string,
  fieldName: string,
  value: unknown,
  context?: string,
): T[] {
  if (!Array.isArray(value)) {
    throw new Error(`mcp ${toolName} returned invalid ${fieldName}${context ? ` for ${context}` : ''}`);
  }
  return value;
}

export class OcpMcpBrokerClient implements BrokerClient {
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private rpcId = 0;
  /** 缓存 search_catalogs 结果 60s,避免每次 skill 调用都重新发现一遍。 */
  private catalogCache: { at: number; list: RegisteredCatalog[] } | null = null;

  constructor(private readonly cfg: SkillGatewayConfig) {
    this.endpoint = cfg.SKILL_GATEWAY_OCP_MCP_URL;
    this.timeoutMs = cfg.SKILL_GATEWAY_FANOUT_TIMEOUT_MS;
  }

  /** 返回最近一次成功 list 出的 catalog 列表(供 dashboard 用)。 */
  get catalogs(): CatalogEntry[] {
    return (this.catalogCache?.list ?? []).map((c) => ({
      id: c.catalog_id,
      name: c.catalog_name,
      base_url: c.query_url ?? this.endpoint,
    }));
  }

  /**
   * MCP tools/call 的统一调用器:
   *   - 走 JSON-RPC over HTTP
   *   - 必须带 Accept: application/json, text/event-stream(MCP Streamable HTTP 协议要求)
   *   - 返回值在 result.content[0].text 里,是 JSON 字符串,需要二次 parse
   */
  private async callTool<T = any>(name: string, args: Record<string, unknown>): Promise<T> {
    const id = ++this.rpcId;
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`mcp ${name} HTTP ${res.status}: ${detail.slice(0, 200)}`);
    }
    const rpc = (await res.json()) as McpJsonRpcResponse<McpToolResult>;
    if (rpc.error) {
      throw new Error(`mcp ${name} JSON-RPC error ${rpc.error.code}: ${rpc.error.message}`);
    }
    const toolResult = rpc.result;
    if (!toolResult || !Array.isArray(toolResult.content) || toolResult.content.length === 0) {
      throw new Error(`mcp ${name}: empty result content`);
    }
    const first = toolResult.content[0]!;
    if (first.type !== 'text' || typeof first.text !== 'string') {
      throw new Error(`mcp ${name}: unexpected content[0].type=${first.type}`);
    }
    if (toolResult.isError) {
      throw new Error(`mcp ${name} tool error: ${first.text.slice(0, 200)}`);
    }
    try {
      return JSON.parse(first.text) as T;
    } catch (e) {
      throw new Error(`mcp ${name}: result text is not JSON: ${first.text.slice(0, 200)}`);
    }
  }

  /** 列已注册的健康 catalog。带 60s 缓存。 */
  private async listHealthyCatalogs(): Promise<RegisteredCatalog[]> {
    if (this.catalogCache && Date.now() - this.catalogCache.at < CATALOG_CACHE_TTL_MS) {
      return this.catalogCache.list;
    }
    const inner = await this.callTool<{ catalogs?: RegisteredCatalog[] }>('search_catalogs', {
      limit: 20,
    });
    const all = requireToolArray<RegisteredCatalog>('search_catalogs', 'catalogs', inner.catalogs);
    // 只保留健康节点;其余 catalog 即使列出来也查不到东西
    const healthy = all.filter((c) => c.health_status === 'healthy');
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
            catalog_id: 'ocp_mcp',
            catalog_name: 'OCP MCP Registry',
            ok: false,
            count: 0,
            error: `search_catalogs failed: ${e instanceof Error ? e.message : String(e)}`,
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
      supportedQueryPacks: routeSupportedQueryPacks(cat.route_hint, cat.catalog_id),
    });
    const inner = await this.callTool<{
      catalog_id?: string;
      catalog_name?: string;
      entries?: any[];
    }>('query_catalog', {
      // route_hint 优先,MCP server 文档推荐这么传
      ...(cat.route_hint ? { route_hint: cat.route_hint } : { catalog_id: cat.catalog_id }),
      ...(queryPolicy ? { query_pack: queryPolicy.queryPack } : {}),
      ...(queryPolicy?.queryMode ? { query_mode: queryPolicy.queryMode } : {}),
      query,
      limit,
      offset: 0,
    });
    const entries = requireToolArray<any>('query_catalog', 'entries', inner.entries, `catalog ${cat.catalog_id}`);
    // entries[].entry 才是真正的 CatalogEntry(MCP 在外层包了一层元信息)
    const hits = entries.map((item: any) =>
      normalizeEntry(
        inner.catalog_id ?? cat.catalog_id,
        inner.catalog_name ?? cat.catalog_name,
        item?.entry ?? item,
      ),
    );
    return { hits, elapsed_ms: Date.now() - t0 };
  }

  async resolve(opts: {
    catalog_id: string;
    entry_ref: string;
    sub_id?: string;
  }): Promise<ResolveResult> {
    try {
      // sub_id 透传放 requested_fields,跟 LocalCatalogsBrokerClient 保持一致的约定。
      // 真正实现归因要 catalog 端在 mint URL 时把它写进 affiliate 参数。
      const inner = await this.callTool<any>('resolve_catalog_entry', {
        catalog_id: opts.catalog_id,
        entry_id: opts.entry_ref,
        purpose: 'checkout',
        live_check: true,
        ...(opts.sub_id ? { requested_fields: [`sub_id:${opts.sub_id}`] } : {}),
      });
      // ocp.deeplumen.io 的 resolve 把购买/查看/联系动作放在 `actions` 数组里
      // (而非 OCP 1.0 spec 的 `action_bindings`)。两个字段都兜底找一下。
      const actions: any[] = Array.isArray(inner?.actions)
        ? inner.actions
        : Array.isArray(inner?.action_bindings)
          ? inner.action_bindings
          : [];
      // 优先 buy_now,其次任意 url 类型 action
      const urlAction =
        actions.find((a) => a?.action_id === 'buy_now' && a?.entrypoint?.url) ??
        actions.find((a) => a?.action_type === 'url' && a?.entrypoint?.url);
      const shortAction = actions.find((a) => /short/i.test(a?.label ?? '') && a?.entrypoint?.url);
      return {
        catalog_id: opts.catalog_id,
        deeplink_url: urlAction?.entrypoint?.url,
        short_url: shortAction?.entrypoint?.url,
        raw: inner,
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
        base_url: c.query_url ?? this.endpoint,
        ok: c.health_status === 'healthy',
        latency_ms: elapsed,
      }));
    } catch (e) {
      return [
        {
          id: 'ocp_mcp',
          name: 'OCP MCP Registry',
          base_url: this.endpoint,
          ok: false,
          latency_ms: Date.now() - t0,
          error: e instanceof Error ? e.message : String(e),
        },
      ];
    }
  }
}
