import { FormEvent, useEffect, useMemo, useState } from 'react';
import { findLatestCatalogSummary } from './catalog-results';
import { agentPromptExample, chromeSetupSteps, protocolSteps, shortcutTool } from './help-content';
import { createOcpMcpHttpClient } from './mcp/client';
import { useOcpMcpDemoWebMcp } from './webmcp/useOcpMcpDemoWebMcp';
import type { DemoCallRecord, OcpMcpDemoContext } from './webmcp/tools';

const endpoint = import.meta.env.VITE_OCP_MCP_PROXY_PATH || '/api/ocp-mcp';
const defaultRegistrationBaseUrl = 'https://ocp.deeplumen.io';
const quickSearches = ['shoes', 'lipstick', 'chocolate', 'beef sauce', 'gift'];

export function App() {
  const [history, setHistory] = useState<DemoCallRecord[]>([]);
  const [mcpTools, setMcpTools] = useState<Array<{ name: string; description?: string; inputSchema?: unknown }>>([]);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('shoes');
  const [manualBusy, setManualBusy] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [showTechnical, setShowTechnical] = useState(false);
  const client = useMemo(() => createOcpMcpHttpClient({ endpoint }), []);

  useEffect(() => {
    let cancelled = false;

    async function loadMetadata() {
      try {
        setMetadataError(null);
        await client.initialize();
        const tools = await client.listTools();
        if (!cancelled) setMcpTools(tools);
      } catch (error) {
        if (!cancelled) {
          setMetadataError(error instanceof Error ? error.message : 'Failed to load MCP tool metadata');
        }
      }
    }

    void loadMetadata();
    return () => {
      cancelled = true;
    };
  }, [client]);

  const context = useMemo<OcpMcpDemoContext>(() => ({
    getState: () => ({
      webMcpAvailable: Boolean((navigator as Navigator & { modelContext?: unknown }).modelContext),
      mcpEndpoint: client.endpoint,
      history,
    }),
    callMcpTool: (name, args) => client.callTool(name, args),
    recordCall: (record) => {
      setHistory((current) => [{
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        ...record,
      }, ...current].slice(0, 20));
    },
  }), [client, history]);

  const webMcp = useOcpMcpDemoWebMcp(context, mcpTools);
  const latest = history[0] ?? null;
  const summary = findLatestCatalogSummary(history);
  const products = summary?.products ?? [];

  async function runSearch(query = searchQuery) {
    const normalizedQuery = query.trim() || 'shoes';
    const input = {
      registration_base_url: defaultRegistrationBaseUrl,
      catalog_query: 'commerce product catalog',
      query: normalizedQuery,
      limit: 12,
    };

    setSearchQuery(normalizedQuery);
    setManualBusy(true);
    try {
      const result = await client.callTool('find_and_query_catalog', input);
      context.recordCall({
        toolName: 'ocp.mcp.find_and_query_catalog',
        input,
        result,
      });
    } catch (error) {
      context.recordCall({
        toolName: 'ocp.mcp.find_and_query_catalog',
        input,
        error: error instanceof Error ? error.message : '查询失败',
      });
    } finally {
      setManualBusy(false);
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runSearch();
  }

  return (
    <main className="market-shell">
      <header className="market-header">
        <a className="brand" href="/" aria-label="OCP Mall home">
          <strong>OCP</strong>
          <span>Catalog Mall</span>
        </a>

        <form className="search-bar" onSubmit={submitSearch}>
          <label className="search-type" htmlFor="mall-search">Catalog 商品</label>
          <input
            id="mall-search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="试试 shoes、lipstick、chocolate"
          />
          <button type="submit" disabled={manualBusy || mcpTools.length === 0}>
            {manualBusy ? '搜索中' : '搜索'}
          </button>
        </form>

        <button className="help-button" onClick={() => setHelpOpen(true)}>
          使用说明
        </button>
      </header>

      <section className="mall-hero">
        <div>
          <p className="eyebrow">Chrome WebMCP + OCP MCP Gateway</p>
          <h1>让 AI 像逛商城一样搜索 Catalog</h1>
          <p>
            这个 demo 不新增业务后端：前端页面连接既有 OCP MCP gateway，WebMCP 工具调用也会回到同一套商品橱窗里展示。
          </p>
        </div>
        <div className="hero-metrics" aria-label="连接状态">
          <StatusPill label="WebMCP" value={webMcp.available ? '已开启' : '未检测到'} tone={webMcp.available ? 'ok' : 'warn'} />
          <StatusPill label="MCP 工具" value={metadataError ? '连接失败' : `${mcpTools.length} 个`} tone={metadataError ? 'warn' : mcpTools.length ? 'ok' : 'muted'} />
          <StatusPill label="Registration" value="ocp.deeplumen.io" tone="plain" />
        </div>
      </section>

      <section className="quick-lane" aria-label="快捷搜索">
        <span>热门搜索</span>
        {quickSearches.map((query) => (
          <button key={query} onClick={() => void runSearch(query)} disabled={manualBusy}>
            {query}
          </button>
        ))}
      </section>

      {metadataError ? <p className="banner-error">{metadataError}</p> : null}

      <section className="commerce-layout">
        <aside className="agent-panel" aria-label="AI 调用轨迹">
          <div className="panel-heading">
            <p className="eyebrow">AI Agent</p>
            <h2>调用轨迹</h2>
          </div>
          <ol className="agent-steps">
            {protocolSteps.map((step, index) => (
              <li key={step.tool} className={index === 0 || latest ? 'active' : undefined}>
                <span>{index + 1}</span>
                <div>
                  <strong>{step.label}</strong>
                  <code>{step.tool.replace('ocp.mcp.', '')}</code>
                </div>
              </li>
            ))}
          </ol>

          <div className="latest-call">
            <strong>最近一次调用</strong>
            {latest ? (
              <>
                <p>{friendlyToolName(latest.toolName)}</p>
                <small>{new Date(latest.createdAt).toLocaleTimeString()}</small>
              </>
            ) : (
              <p>搜索后会显示 AI 或页面调用过的工具。</p>
            )}
          </div>
        </aside>

        <section className="shelf" aria-label="商品结果">
          <div className="shelf-head">
            <div>
              <p className="eyebrow">商品橱窗</p>
              <h2>{summary?.error ? '搜索遇到问题' : summary?.title ?? '等 AI 上架第一批商品'}</h2>
              <p>{summary?.catalogName ? `来自 ${summary.catalogName}` : 'Registration 先找目录，Catalog 再返回商品。'}</p>
            </div>
            <button className="secondary-button" onClick={() => setShowTechnical((value) => !value)}>
              {showTechnical ? '隐藏技术记录' : '查看技术记录'}
            </button>
          </div>

          {summary?.error ? <p className="banner-error">{summary.error}</p> : null}

          {products.length > 0 ? (
            <div className="product-grid">
              {products.map((product, index) => (
                <article className="product-card" key={product.id}>
                  <div className="product-media">
                    {product.imageUrl ? <img src={product.imageUrl} alt={product.title} /> : <span>{index + 1}</span>}
                    {index < 3 ? <b>AI 推荐</b> : null}
                  </div>
                  <div className="product-info">
                    <h3>{product.title}</h3>
                    <p>{product.subtitle ?? product.brand ?? 'OCP Catalog item'}</p>
                    <div className="product-meta">
                      <strong>{product.price ?? '价格待确认'}</strong>
                      <span>{product.availability ?? '库存待确认'}</span>
                    </div>
                    {product.productUrl ? (
                      <a href={product.productUrl} target="_blank" rel="noreferrer">
                        打开商品
                      </a>
                    ) : (
                      <span className="disabled-link">等待 resolve</span>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-shelf">
              <strong>还没有商品</strong>
              <p>点“搜索”或让 Chrome 里的 agent 调用 WebMCP 工具，商品会自动摆到这里。</p>
            </div>
          )}
        </section>
      </section>

      <section className="tool-dock">
        <article>
          <p className="eyebrow">本页注册给 AI 的工具</p>
          <div className="tool-cloud">
            {webMcp.tools.map((tool) => (
              <span key={tool}>{friendlyToolName(tool)}</span>
            ))}
          </div>
        </article>
        <article>
          <p className="eyebrow">快捷组合工具</p>
          <h2>{shortcutTool.tool}</h2>
          <p>{shortcutTool.purpose}</p>
        </article>
      </section>

      {showTechnical ? (
        <section className="technical-panel">
          <div className="panel-heading">
            <p className="eyebrow">Debug</p>
            <h2>MCP 原始记录</h2>
          </div>
          {latest ? <pre>{JSON.stringify(latest, null, 2)}</pre> : <p>还没有调用记录。</p>}
        </section>
      ) : null}

      {helpOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setHelpOpen(false)}>
          <section
            className="help-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-title">
              <div>
                <p className="eyebrow">使用说明</p>
                <h2 id="help-title">如何让 agent 使用这个商城</h2>
              </div>
              <button className="close-action" onClick={() => setHelpOpen(false)} aria-label="关闭使用说明">
                ×
              </button>
            </div>

            <div className="help-grid">
              <article>
                <h3>Chrome 需要先启用</h3>
                <ol>
                  {chromeSetupSteps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </article>

              <article>
                <h3>可以这样告诉 agent</h3>
                <pre>{agentPromptExample}</pre>
              </article>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function StatusPill({ label, value, tone }: { label: string; value: string; tone: 'ok' | 'warn' | 'muted' | 'plain' }) {
  return (
    <div className={`status-pill ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function friendlyToolName(toolName: string) {
  const labels: Record<string, string> = {
    'ocp.mcp.get_page_state': '页面状态',
    'ocp.mcp.describe_ocp_catalog': '说明 OCP',
    'ocp.mcp.search_catalogs': '找目录',
    'ocp.mcp.inspect_catalog': '看能力',
    'ocp.mcp.query_catalog': '查商品',
    'ocp.mcp.resolve_catalog_entry': '看详情',
    'ocp.mcp.find_and_query_catalog': '自动找货',
  };

  return labels[toolName] ?? toolName;
}
