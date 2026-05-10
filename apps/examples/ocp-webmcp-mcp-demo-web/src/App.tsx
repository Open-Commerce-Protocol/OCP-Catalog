import { FormEvent, useEffect, useMemo, useState } from 'react';
import { findLatestCatalogSummary, summarizeCatalogResponse, type CatalogSearchSummary, type ProductCard } from './catalog-results';
import { agentPromptExample, chromeSetupSteps } from './help-content';
import { listCatalogProducts, searchCatalogOptions, type CatalogOption } from './ocp-http';
import { useOcpMcpDemoWebMcp } from './webmcp/useOcpMcpDemoWebMcp';
import type { DataSourceInput, DemoCallRecord, OcpMcpDemoContext, OpenProductInput, ProductSearchInput } from './webmcp/tools';

const defaultRegistrationBaseUrl = 'https://ocp.deeplumen.io';

export function App() {
  const [history, setHistory] = useState<DemoCallRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [registrationBaseUrl, setRegistrationBaseUrl] = useState(defaultRegistrationBaseUrl);
  const [catalogs, setCatalogs] = useState<CatalogOption[]>([]);
  const [selectedCatalogId, setSelectedCatalogId] = useState('');
  const [productSummary, setProductSummary] = useState<CatalogSearchSummary | null>(null);
  const [loadingCatalogs, setLoadingCatalogs] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const latestWebMcpSummary = findLatestCatalogSummary(history);
  const summary = latestWebMcpSummary ?? productSummary;
  const products = summary?.products ?? [];
  const selectedCatalog = catalogs.find((catalog) => catalog.catalogId === selectedCatalogId) ?? catalogs[0];

  useEffect(() => {
    void refreshCatalogs();
  }, []);

  const context = useMemo<OcpMcpDemoContext>(() => ({
    getState: () => ({
      webMcpAvailable: Boolean((navigator as Navigator & { modelContext?: unknown }).modelContext),
      registrationBaseUrl,
      selectedCatalogId: selectedCatalog?.catalogId,
      selectedCatalogName: selectedCatalog?.catalogName,
      productCount: products.length,
      history,
    }),
    listProducts: (input) => runPageListProducts(input),
    searchProducts: (input) => runPageSearchProducts(input),
    setDataSource: (input) => runPageSetDataSource(input),
    openProductPage: (input) => runPageOpenProductPage(input),
    recordCall: (record) => {
      setHistory((current) => [{
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        ...record,
      }, ...current].slice(0, 20));
    },
  }), [history, products, registrationBaseUrl, selectedCatalog]);

  const webMcp = useOcpMcpDemoWebMcp(context);

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

  async function runPageListProducts(input: ProductSearchInput) {
    const catalog = selectedCatalog;
    if (!catalog) throw new Error('No selected Catalog');
    const response = await listCatalogProducts(catalog, {
      limit: normalizeLimit(input.limit),
      offset: normalizeOffset(input.offset),
    });
    const nextSummary = summarizeCatalogResponse(response, catalog.catalogName);
    setSearchQuery('');
    setProductSummary(nextSummary);
    return nextSummary;
  }

  async function runPageSearchProducts(input: ProductSearchInput) {
    const catalog = selectedCatalog;
    if (!catalog) throw new Error('No selected Catalog');
    const query = typeof input.query === 'string' ? input.query : '';
    const response = await listCatalogProducts(catalog, {
      query,
      limit: normalizeLimit(input.limit),
      offset: normalizeOffset(input.offset),
    });
    const nextSummary = summarizeCatalogResponse(response, catalog.catalogName);
    setSearchQuery(query);
    setProductSummary(nextSummary);
    return nextSummary;
  }

  async function runPageSetDataSource(input: DataSourceInput) {
    const nextRegistrationBaseUrl = typeof input.registration_base_url === 'string' && input.registration_base_url.trim()
      ? input.registration_base_url.trim()
      : registrationBaseUrl;
    const nextCatalogs = await searchCatalogOptions(nextRegistrationBaseUrl);
    const requestedCatalogId = typeof input.catalog_id === 'string' ? input.catalog_id : undefined;
    const nextCatalog = nextCatalogs.find((catalog) => catalog.catalogId === requestedCatalogId) ?? nextCatalogs[0];
    setRegistrationBaseUrl(nextRegistrationBaseUrl);
    setCatalogs(nextCatalogs);
    setSelectedCatalogId(nextCatalog?.catalogId ?? '');
    if (!nextCatalog) throw new Error('Registration node returned no selectable Catalog');
    const response = await listCatalogProducts(nextCatalog, { limit: 24, offset: 0 });
    const nextSummary = summarizeCatalogResponse(response, nextCatalog.catalogName);
    setProductSummary(nextSummary);
    return {
      registrationBaseUrl: nextRegistrationBaseUrl,
      selectedCatalog: nextCatalog,
      productCount: nextSummary.products.length,
    };
  }

  async function runPageOpenProductPage(input: OpenProductInput) {
    const product = findProduct(products, input);
    const productUrl = product?.productUrl ?? normalizeString(input.product_url);
    if (!productUrl) {
      throw new Error('No matching product page was found. Run list/search first, then pass product_id, product_url, or exact title.');
    }

    const openedWindow = window.open(productUrl, '_blank', 'noopener,noreferrer');
    if (openedWindow) openedWindow.opener = null;

    return {
      opened: Boolean(openedWindow),
      productId: product?.id ?? normalizeString(input.product_id),
      title: product?.title ?? normalizeString(input.title),
      productUrl,
      message: openedWindow
        ? 'Product page opened in a new tab.'
        : 'The browser may have blocked the new tab. Use productUrl to open it manually.',
    };
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
                <p>当前 WebMCP：{webMcp.available ? '已检测到' : '未检测到'}；页面已注册工具 {webMcp.tools.length} 个。</p>
                <p>这些是页面工具，不需要启动 `apps/ocp-mcp-server`。MCP gateway 只在你想测试服务端 MCP 时才需要。</p>
              </article>

              <article>
                <h3>可以这样告诉 agent</h3>
                <pre>{agentPromptExample}</pre>
                <p>Tool Inspector 里应该能看到 `ocp.mall.list_products`、`ocp.mall.search_products`、`ocp.mall.open_product_page`、`ocp.mall.set_data_source` 和 `ocp.mall.get_page_state`。</p>
              </article>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function normalizeLimit(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(Math.trunc(value), 1), 50) : 24;
}

function normalizeOffset(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(Math.trunc(value), 0) : 0;
}

function findProduct(products: readonly ProductCard[], input: OpenProductInput) {
  const productId = normalizeString(input.product_id);
  if (productId) {
    const product = products.find((candidate) => candidate.id === productId);
    if (product) return product;
  }

  const productUrl = normalizeString(input.product_url);
  if (productUrl) {
    const product = products.find((candidate) => candidate.productUrl === productUrl);
    if (product) return product;
  }

  const title = normalizeString(input.title)?.toLocaleLowerCase();
  if (!title) return undefined;
  return products.find((candidate) => candidate.title.toLocaleLowerCase() === title)
    ?? products.find((candidate) => candidate.title.toLocaleLowerCase().includes(title));
}

function normalizeString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
