import { FormEvent, useEffect, useMemo, useState } from 'react';
import { findLatestCatalogSummary, summarizeCatalogResponse, type CatalogSearchSummary } from './catalog-results';
import { agentPromptExample, chromeSetupSteps } from './help-content';
import { createOcpMcpHttpClient } from './mcp/client';
import { listCatalogProducts, searchCatalogOptions, type CatalogOption } from './ocp-http';
import { useOcpMcpDemoWebMcp } from './webmcp/useOcpMcpDemoWebMcp';
import type { DemoCallRecord, OcpMcpDemoContext } from './webmcp/tools';

const endpoint = import.meta.env.VITE_OCP_MCP_PROXY_PATH || '/api/ocp-mcp';
const defaultRegistrationBaseUrl = 'https://ocp.deeplumen.io';

export function App() {
  const [history, setHistory] = useState<DemoCallRecord[]>([]);
  const [mcpTools, setMcpTools] = useState<Array<{ name: string; description?: string; inputSchema?: unknown }>>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [registrationBaseUrl, setRegistrationBaseUrl] = useState(defaultRegistrationBaseUrl);
  const [catalogs, setCatalogs] = useState<CatalogOption[]>([]);
  const [selectedCatalogId, setSelectedCatalogId] = useState('');
  const [productSummary, setProductSummary] = useState<CatalogSearchSummary | null>(null);
  const [loadingCatalogs, setLoadingCatalogs] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const client = useMemo(() => createOcpMcpHttpClient({ endpoint }), []);

  useEffect(() => {
    let cancelled = false;

    async function loadMetadata() {
      try {
        await client.initialize();
        const tools = await client.listTools();
        if (!cancelled) setMcpTools(tools);
      } catch {
        if (!cancelled) setMcpTools([]);
      }
    }

    void loadMetadata();
    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => {
    void refreshCatalogs();
  }, []);

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
  const latestWebMcpSummary = findLatestCatalogSummary(history);
  const summary = latestWebMcpSummary ?? productSummary;
  const products = summary?.products ?? [];
  const selectedCatalog = catalogs.find((catalog) => catalog.catalogId === selectedCatalogId) ?? catalogs[0];

  async function refreshCatalogs() {
    setLoadingCatalogs(true);
    setPageError(null);
    try {
      const nextCatalogs = await searchCatalogOptions(registrationBaseUrl);
      setCatalogs(nextCatalogs);
      const firstCatalog = nextCatalogs[0];
      setSelectedCatalogId((current) => nextCatalogs.some((catalog) => catalog.catalogId === current) ? current : firstCatalog?.catalogId ?? '');
      if (firstCatalog) {
        await loadProducts(firstCatalog, searchQuery);
      } else {
        setProductSummary(null);
        setPageError('这个注册中心没有返回可查询的 Commerce Catalog。');
      }
    } catch (error) {
      setProductSummary(null);
      setPageError(error instanceof Error ? error.message : '注册中心连接失败');
    } finally {
      setLoadingCatalogs(false);
    }
  }

  async function loadProducts(catalog = selectedCatalog, query = searchQuery) {
    if (!catalog) {
      setPageError('请先选择一个 Catalog。');
      return;
    }

    setLoadingProducts(true);
    setPageError(null);
    try {
      const response = await listCatalogProducts(catalog, {
        query,
        limit: 24,
        offset: 0,
      });
      setProductSummary(summarizeCatalogResponse(response, catalog.catalogName));
    } catch (error) {
      setProductSummary(null);
      setPageError(error instanceof Error ? error.message : 'Catalog 查询失败');
    } finally {
      setLoadingProducts(false);
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadProducts(selectedCatalog, searchQuery);
  }

  return (
    <main className="market-shell">
      <header className="market-header">
        <a className="brand" href="/" aria-label="OCP Mall home">
          <strong>OCP</strong>
          <span>Catalog Mall</span>
        </a>

        <form className="search-bar" onSubmit={submitSearch}>
          <label className="search-type" htmlFor="mall-search">宝贝</label>
          <input
            id="mall-search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="搜索商品；留空则列出 Product Commerce Catalog"
          />
          <button type="submit" disabled={loadingProducts || loadingCatalogs || !selectedCatalog}>
            {loadingProducts ? '搜索中' : '搜索'}
          </button>
        </form>

        <div className="header-actions">
          <details className="source-menu">
            <summary>数据源</summary>
            <div className="source-popover">
              <label>
                注册中心
                <input value={registrationBaseUrl} onChange={(event) => setRegistrationBaseUrl(event.target.value)} />
              </label>
              <button type="button" onClick={() => void refreshCatalogs()} disabled={loadingCatalogs}>
                {loadingCatalogs ? '加载中' : '刷新 Catalog'}
              </button>
              <label>
                Catalog
                <select
                  value={selectedCatalog?.catalogId ?? ''}
                  onChange={(event) => setSelectedCatalogId(event.target.value)}
                >
                  {catalogs.map((catalog) => (
                    <option key={catalog.catalogId} value={catalog.catalogId}>
                      {catalog.catalogName}
                    </option>
                  ))}
                </select>
              </label>
              {selectedCatalog ? (
                <p>
                  当前通过 <code>{selectedCatalog.queryUrl}</code> 查询；
                  搜索词为空时发送 clean list：<code>{'{ catalog_id, limit, offset }'}</code>。
                </p>
              ) : null}
            </div>
          </details>

          <button className="help-button" onClick={() => setHelpOpen(true)}>
            使用说明
          </button>
        </div>
      </header>

      {pageError ? <p className="banner-error">{pageError}</p> : null}

      <section className="shelf" aria-label="商品结果">
        {loadingProducts || loadingCatalogs ? (
          <div className="empty-shelf">
            <strong>正在上架商品</strong>
            <p>正在从注册中心选择 Catalog，并调用 Catalog 的 HTTP query/list 接口。</p>
          </div>
        ) : products.length > 0 ? (
          <div className="product-grid">
            {products.map((product) => (
              <article className="product-card" key={product.id}>
                <div className="product-media">
                  {product.imageUrl ? <img src={product.imageUrl} alt={product.title} /> : <span>OCP</span>}
                </div>
                <div className="product-info">
                  <h2>{product.title}</h2>
                  <p>{product.subtitle ?? product.brand ?? summary?.catalogName ?? 'Catalog item'}</p>
                  <div className="product-meta">
                    <strong>{product.price ?? '价格待确认'}</strong>
                    <span>{product.availability ?? '库存待确认'}</span>
                  </div>
                  {product.productUrl ? (
                    <a href={product.productUrl} target="_blank" rel="noreferrer">
                      查看商品
                    </a>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-shelf">
            <strong>还没有商品</strong>
            <p>点击搜索，或在数据源里选择注册中心和 Catalog。</p>
          </div>
        )}
      </section>

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
                <p className="eyebrow">WebMCP 使用说明</p>
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
                <p>当前 WebMCP：{webMcp.available ? '已检测到' : '未检测到'}；已注册工具 {webMcp.tools.length} 个。</p>
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
