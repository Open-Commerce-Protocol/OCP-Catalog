import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { findLatestCatalogSummary, summarizeCatalogResponse, type CatalogSearchSummary, type ProductCard } from './catalog-results';
import { agentPromptExample, chromeSetupSteps, puppeteerSetupSteps } from './help-content';
import {
  listCatalogProducts,
  loadCatalogManifestOptionsIsolated,
  queryModesForPack,
  queryPackIds,
  searchCatalogOptions,
  selectLoadedCatalog,
  type CatalogManifestFailure,
  type CatalogOption,
  type CatalogQueryMode,
} from './ocp-http';
import { useOcpMcpDemoWebMcp } from './webmcp/useOcpMcpDemoWebMcp';
import type { DataSourceInput, DemoCallRecord, OcpMcpDemoContext, OpenProductInput, ProductSearchInput } from './webmcp/tools';

const defaultRegistrationBaseUrl = 'https://ocp.deeplumen.io/registry';

export function App() {
  const [history, setHistory] = useState<DemoCallRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchQueryPack, setSearchQueryPack] = useState('');
  const [registrationBaseUrl, setRegistrationBaseUrl] = useState(defaultRegistrationBaseUrl);
  const [catalogs, setCatalogs] = useState<CatalogOption[]>([]);
  const [catalogFailures, setCatalogFailures] = useState<CatalogManifestFailure[]>([]);
  const [selectedCatalogId, setSelectedCatalogId] = useState('');
  const [productSummary, setProductSummary] = useState<CatalogSearchSummary | null>(null);
  const [loadingCatalogs, setLoadingCatalogs] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const catalogLoadGeneration = useRef(0);
  const productLoadGeneration = useRef(0);
  const productCatalogId = useRef<string | null>(null);
  const skipNextSelectionLoad = useRef(false);
  const selectedCatalog = catalogs.find((catalog) => catalog.catalogId === selectedCatalogId);
  const latestWebMcpSummary = findLatestCatalogSummary(history);
  const summary = latestWebMcpSummary?.catalogName === selectedCatalog?.catalogName
    ? latestWebMcpSummary
    : productSummary;
  const products = summary?.products ?? [];
  const selectedQueryPack = resolveQueryPackForCatalog(selectedCatalog, searchQueryPack);
  const selectedCatalogHasQueryPacks = Boolean(selectedCatalog?.queryPackOptions.length);

  useEffect(() => {
    void refreshCatalogs();
  }, []);

  // refreshCatalogs loads the first catalog on mount; this reloads products when the
  // user (or the set_data_source tool) switches to a different catalog afterwards.
  // Keyed on catalogId so it fires only on a real switch, not on every catalogs
  // array identity change. Reset the search box so the new catalog browses cleanly.
  useEffect(() => {
    if (!selectedCatalog) return;
    if (skipNextSelectionLoad.current) {
      skipNextSelectionLoad.current = false;
      return;
    }
    setSearchQuery('');
    void loadProducts(selectedCatalog, '', resolveQueryPackForCatalog(selectedCatalog, searchQueryPack));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCatalog?.catalogId]);

  const context = useMemo<OcpMcpDemoContext>(() => ({
    getState: () => ({
      webMcpAvailable: Boolean((navigator as Navigator & { modelContext?: unknown }).modelContext),
      registrationBaseUrl,
      selectedCatalogId: selectedCatalog?.catalogId,
      selectedCatalogName: selectedCatalog?.catalogName,
      queryPackOptions: selectedCatalog?.queryPackOptions ?? [],
      catalogFailures,
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
  }), [catalogFailures, history, products, registrationBaseUrl, selectedCatalog]);

  const webMcp = useOcpMcpDemoWebMcp(context);

  async function refreshCatalogs() {
    const generation = ++catalogLoadGeneration.current;
    productLoadGeneration.current += 1;
    setLoadingCatalogs(true);
    setPageError(null);
    try {
      const nextCatalogs = await searchCatalogOptions(registrationBaseUrl);
      const manifestResult = await loadCatalogManifestOptionsIsolated(nextCatalogs);
      if (generation !== catalogLoadGeneration.current) return;
      const catalogOptions = manifestResult.catalogs;
      setCatalogs(catalogOptions);
      setCatalogFailures(manifestResult.failures);
      const firstCatalog = catalogOptions[0];
      const nextCatalogId = catalogOptions.some((catalog) => catalog.catalogId === selectedCatalogId) ? selectedCatalogId : firstCatalog?.catalogId ?? '';
      setSelectedCatalogId(nextCatalogId);
      if (!firstCatalog) {
        setProductSummary(null);
        setPageError(manifestResult.failures.length
          ? `Registration search succeeded, but all ${manifestResult.failures.length} Catalog manifests failed to load.`
          : '这个注册中心没有返回可用的商品目录。');
      } else if (nextCatalogId === selectedCatalogId) {
        // Same catalog id (e.g. manual refresh): the catalog-switch effect won't
        // fire, so reload products explicitly here.
        const catalog = catalogOptions.find((item) => item.catalogId === nextCatalogId) ?? firstCatalog;
        await loadProducts(catalog, searchQuery, resolveQueryPackForCatalog(catalog, searchQueryPack));
      }
      // Otherwise the selected catalog id changed; the catalog-switch effect loads it.
    } catch (error) {
      if (generation !== catalogLoadGeneration.current) return;
      setCatalogs([]);
      setCatalogFailures([]);
      setSelectedCatalogId('');
      setProductSummary(null);
      setPageError(error instanceof Error ? error.message : '注册中心连接失败');
    } finally {
      if (generation === catalogLoadGeneration.current) setLoadingCatalogs(false);
    }
  }

  async function loadProducts(catalog = selectedCatalog, query = searchQuery, queryPack = selectedQueryPack) {
    if (!catalog) {
      setPageError('请先选择一个商品目录。');
      return;
    }

    const generation = ++productLoadGeneration.current;
    if (productCatalogId.current !== catalog.catalogId) {
      productCatalogId.current = null;
      setProductSummary(null);
    }
    setLoadingProducts(true);
    setPageError(null);
    try {
      const response = await listCatalogProducts(catalog, {
        query,
        queryPack: query?.trim() ? queryPack : undefined,
        limit: 24,
        offset: 0,
      });
      if (generation !== productLoadGeneration.current) return;
      productCatalogId.current = catalog.catalogId;
      setProductSummary(summarizeCatalogResponse(response, catalog.catalogName));
    } catch (error) {
      if (generation !== productLoadGeneration.current) return;
      setPageError(error instanceof Error ? error.message : '商品加载失败');
    } finally {
      if (generation === productLoadGeneration.current) setLoadingProducts(false);
    }
  }

  async function runPageListProducts(input: ProductSearchInput) {
    const catalog = selectedCatalog;
    if (!catalog) throw new Error('No selected Catalog');
    const generation = ++productLoadGeneration.current;
    const response = await listCatalogProducts(catalog, {
      queryPack: normalizeQueryPack(input.query_pack),
      queryMode: normalizeQueryMode(input.query_mode),
      filters: normalizeFilters(input.filters),
      limit: normalizeLimit(input.limit),
      offset: normalizeOffset(input.offset),
    });
    const nextSummary = summarizeCatalogResponse(response, catalog.catalogName);
    if (generation === productLoadGeneration.current) {
      productCatalogId.current = catalog.catalogId;
      setSearchQuery('');
      setProductSummary(nextSummary);
    }
    return nextSummary;
  }

  async function runPageSearchProducts(input: ProductSearchInput) {
    const catalog = selectedCatalog;
    if (!catalog) throw new Error('No selected Catalog');
    const generation = ++productLoadGeneration.current;
    const query = typeof input.query === 'string' ? input.query : '';
    const queryPack = normalizeQueryPack(input.query_pack);
    const queryMode = normalizeQueryMode(input.query_mode);
    const response = await listCatalogProducts(catalog, {
      query,
      queryPack,
      queryMode,
      filters: normalizeFilters(input.filters),
      limit: normalizeLimit(input.limit),
      offset: normalizeOffset(input.offset),
    });
    const nextSummary = summarizeCatalogResponse(response, catalog.catalogName);
    if (generation === productLoadGeneration.current) {
      productCatalogId.current = catalog.catalogId;
      setSearchQuery(query);
      if (queryPack) setSearchQueryPack(queryPack);
      else if (queryMode) setSearchQueryPack(packForQueryMode(catalog, queryMode));
      setProductSummary(nextSummary);
    }
    return nextSummary;
  }

  async function runPageSetDataSource(input: DataSourceInput) {
    const generation = ++catalogLoadGeneration.current;
    productLoadGeneration.current += 1;
    const nextRegistrationBaseUrl = typeof input.registration_base_url === 'string' && input.registration_base_url.trim()
      ? input.registration_base_url.trim()
      : registrationBaseUrl;
    const nextCatalogs = await searchCatalogOptions(nextRegistrationBaseUrl);
    const manifestResult = await loadCatalogManifestOptionsIsolated(nextCatalogs);
    const catalogOptions = manifestResult.catalogs;
    const requestedCatalogId = typeof input.catalog_id === 'string' ? input.catalog_id : undefined;
    const nextCatalog = selectLoadedCatalog(manifestResult, requestedCatalogId);
    if (!nextCatalog) {
      throw new Error(manifestResult.failures.length
        ? `Registration search succeeded, but all ${manifestResult.failures.length} Catalog manifests failed to load`
        : 'Registration node returned no selectable Catalog');
    }
    const response = await listCatalogProducts(nextCatalog, { limit: 24, offset: 0 });
    const nextSummary = summarizeCatalogResponse(response, nextCatalog.catalogName);
    if (generation === catalogLoadGeneration.current) {
      skipNextSelectionLoad.current = nextCatalog.catalogId !== selectedCatalogId;
      productCatalogId.current = nextCatalog.catalogId;
      setRegistrationBaseUrl(nextRegistrationBaseUrl);
      setCatalogs(catalogOptions);
      setCatalogFailures(manifestResult.failures);
      setSelectedCatalogId(nextCatalog.catalogId);
      setProductSummary(nextSummary);
    }
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
    void loadProducts(selectedCatalog, searchQuery, selectedQueryPack);
  }

  return (
    <main className="market-shell">
      <header className="market-header">
        <a className="brand" href="/" aria-label="OCP Mall home">
          <strong>OCP</strong>
          <span>Catalog Mall</span>
        </a>

        <form className="search-bar" onSubmit={submitSearch}>
          <label className="search-type" htmlFor="mall-search-pack">模式</label>
          <select
            id="mall-search-pack"
            value={selectedQueryPack ?? ''}
            onChange={(event) => setSearchQueryPack(event.target.value)}
            disabled={!selectedCatalog || !selectedCatalogHasQueryPacks}
            aria-label="搜索模式"
          >
            {queryPackIds(selectedCatalog ?? { queryPackOptions: [] }).map((queryPack) => (
              <option key={queryPack} value={queryPack}>
                {labelQueryPack(selectedCatalog, queryPack)}
              </option>
            ))}
          </select>
          <input
            id="mall-search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="搜索商品；留空则浏览全部商品"
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
                {loadingCatalogs ? '加载中' : catalogFailures.length ? '重新加载数据源' : '刷新 Catalog'}
              </button>
              <label>
                商品目录
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
                  当前使用 <strong>{selectedCatalog.catalogName}</strong>。
                  支持 {selectedCatalog.queryPackOptions.map((option) => labelQueryPack(selectedCatalog, option.packId)).join('、')}。
                </p>
              ) : null}
              {catalogFailures.length ? (
                <section className="source-failures" aria-labelledby="catalog-failure-title" aria-live="polite">
                  <div className="source-failure-heading">
                    <strong id="catalog-failure-title">{catalogFailures.length} 个 Catalog 加载失败</strong>
                    <span>{catalogs.length ? '其余数据源仍可使用' : '当前没有可用数据源'}</span>
                  </div>
                  <ul>
                    {catalogFailures.map((failure) => (
                      <li key={failure.catalogId}>
                        <strong>{failure.catalogName}</strong>
                        <span>{failure.catalogId}</span>
                        <code>{failure.manifestUrl ?? '未提供 manifest URL'}</code>
                        <p>{failure.error}</p>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          </details>

          <button className="help-button" onClick={() => setHelpOpen(true)}>
            使用说明
          </button>
        </div>
      </header>

      {pageError ? <p className="banner-error" role="alert">{pageError}</p> : null}

      <section className="shelf" aria-label="商品结果">
        {loadingProducts || loadingCatalogs ? (
          <div className="empty-shelf">
            <strong>正在上架商品</strong>
            <p>正在连接商品目录并加载商品。</p>
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
                <h3>方式一：Chrome 手动体验</h3>
                <ol>
                  {chromeSetupSteps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                <p>{webMcp.available ? '当前浏览器已经可以让 agent 使用这个页面。' : '当前浏览器还没有检测到 WebMCP，请检查上面的设置。'}</p>
                <h3>方式二：Puppeteer 自动化</h3>
                <ol>
                  {puppeteerSetupSteps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </article>

              <article>
                <h3>可以这样告诉 agent</h3>
                <pre>{agentPromptExample}</pre>
                <p>扩展侧边栏显示当前页面可用后，就可以让 agent 搜索、浏览并打开商品。</p>
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

function normalizeQueryPack(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error(`query_pack must be a string`);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeQueryMode(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === 'keyword' || value === 'filter' || value === 'semantic' || value === 'hybrid') return value;
  throw new Error(`Unsupported query_mode ${String(value)}`);
}

function normalizeFilters(value: unknown) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('filters must be an object');
  return value as Record<string, unknown>;
}

function packForQueryMode(catalog: CatalogOption, mode: CatalogQueryMode) {
  const option = catalog.queryPackOptions.find((candidate) => candidate.queryModes.includes(mode));
  if (!option) {
    throw new Error(`Catalog ${catalog.catalogName} does not support query_mode ${mode}`);
  }
  return option.packId;
}

function labelQueryPack(catalog: CatalogOption | undefined, queryPack: string) {
  const modes = catalog ? queryModesForPack(catalog, queryPack) : [];
  const modeLabel = modes.length ? ` (${modes.join('/')})` : '';
  if (queryPack === 'ocp.query.semantic.v1') return `Semantic${modeLabel}`;
  if (queryPack === 'ocp.query.filter.v1') return `Filter${modeLabel}`;
  if (queryPack === 'ocp.query.keyword.v1') return `Keyword${modeLabel}`;
  return `${queryPack}${modeLabel}`;
}

function resolveQueryPackForCatalog(catalog: CatalogOption | undefined, preferredQueryPack: string) {
  const supportedQueryPacks = catalog ? queryPackIds(catalog) : [];
  if (supportedQueryPacks.includes(preferredQueryPack)) return preferredQueryPack;
  if (supportedQueryPacks.includes('ocp.query.keyword.v1')) return 'ocp.query.keyword.v1';
  return supportedQueryPacks[0];
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
