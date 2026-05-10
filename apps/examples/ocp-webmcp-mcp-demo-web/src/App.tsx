import { useEffect, useMemo, useState } from 'react';
import { agentPromptExample, chromeSetupSteps, protocolSteps, shortcutTool } from './help-content';
import { createOcpMcpHttpClient } from './mcp/client';
import { useOcpMcpDemoWebMcp } from './webmcp/useOcpMcpDemoWebMcp';
import type { DemoCallRecord, OcpMcpDemoContext } from './webmcp/tools';

const endpoint = import.meta.env.VITE_OCP_MCP_PROXY_PATH || '/api/ocp-mcp';
const exampleInput = {
  registration_base_url: 'https://ocp.deeplumen.io',
  catalog_query: 'commerce product catalog',
  query: 'shoes',
  limit: 5,
};

export function App() {
  const [history, setHistory] = useState<DemoCallRecord[]>([]);
  const [mcpTools, setMcpTools] = useState<Array<{ name: string; description?: string; inputSchema?: unknown }>>([]);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [manualBusy, setManualBusy] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
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
  const summary = latest ? summarizeLatestCall(latest) : null;

  async function runExampleSearch() {
    setManualBusy(true);
    try {
      const result = await client.callTool('find_and_query_catalog', exampleInput);
      context.recordCall({
        toolName: 'ocp.mcp.find_and_query_catalog',
        input: exampleInput,
        result,
      });
    } catch (error) {
      context.recordCall({
        toolName: 'ocp.mcp.find_and_query_catalog',
        input: exampleInput,
        error: error instanceof Error ? error.message : '查询失败',
      });
    } finally {
      setManualBusy(false);
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">OCP Catalog WebMCP</p>
          <h1>让浏览器里的 AI 直接查询商品目录</h1>
          <p className="lead">
            这个页面把 OCP Catalog 的查询能力交给 Chrome WebMCP。你可以让支持 WebMCP 的浏览器 AI 调用工具，也可以先点下面的按钮看一次真实查询。
          </p>
        </div>
        <div className="hero-actions">
          <button className="primary-action" onClick={runExampleSearch} disabled={manualBusy || mcpTools.length === 0}>
            {manualBusy ? '正在查询...' : '一键试查鞋子'}
          </button>
          <button className="plain-action" onClick={() => setHelpOpen(true)}>
            使用说明
          </button>
        </div>
      </section>

      <section className="status-strip" aria-label="当前连接状态">
        <dl className="status">
          <div>
            <dt>浏览器 WebMCP</dt>
            <dd className={webMcp.available ? 'ok' : 'warn'}>{webMcp.available ? '已开启' : '未检测到'}</dd>
            <p>{webMcp.available ? 'Chrome 可以看到本页注册的 AI 工具。' : '普通浏览器能看页面，但不能由 WebMCP 调工具。'}</p>
          </div>
          <div>
            <dt>OCP MCP 服务</dt>
            <dd className={metadataError ? 'warn' : mcpTools.length > 0 ? 'ok' : 'muted'}>
              {metadataError ? '连接失败' : mcpTools.length > 0 ? '已连接' : '连接中'}
            </dd>
            <p>{metadataError ?? `${mcpTools.length} 个查询工具已加载。`}</p>
          </div>
          <div>
            <dt>真实目录入口</dt>
            <dd>ocp.deeplumen.io</dd>
            <p>示例会从公开 Registration 节点找到可查询的商品目录。</p>
          </div>
        </dl>
      </section>

      <section className="explainer-grid">
        <article className="panel">
          <span className="step">1</span>
          <h2>浏览器拿到工具</h2>
          <p>页面启动后向本地 MCP 网关询问“你有哪些能力”，再把真实工具注册给 Chrome WebMCP。</p>
        </article>

        <article className="panel">
          <span className="step">2</span>
          <h2>AI 先找目录</h2>
          <p>Registration 节点回答“应该去哪个 Catalog 查”。它不是商品搜索引擎，不直接返回商品。</p>
        </article>

        <article className="panel">
          <span className="step">3</span>
          <h2>再进 Catalog 查询</h2>
          <p>选中 Catalog 后，AI 才会查询商品、库存和价格；用户选中结果后还可以继续 resolve 详情。</p>
        </article>
      </section>

      <section className="panel protocol-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">协议步骤</p>
            <h2>Registration 和 Catalog 是两层不同调用</h2>
          </div>
          <span className="pill">4 步</span>
        </div>
        <div className="protocol-flow">
          {protocolSteps.map((item, index) => (
            <article key={item.tool} className="protocol-step">
              <span className="step">{index + 1}</span>
              <h3>{item.label}</h3>
              <code>{item.tool}</code>
              <p>{item.purpose}</p>
            </article>
          ))}
        </div>
        <div className="shortcut-note">
          <strong>快捷入口</strong>
          <code>{shortcutTool.tool}</code>
          <p>{shortcutTool.purpose}</p>
        </div>
      </section>

      <section className="result-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">查询结果</p>
            <h2>{summary?.title ?? '还没有查询结果'}</h2>
          </div>
          {latest ? <span className={summary?.error ? 'pill danger' : 'pill success'}>{summary?.error ? '查询失败' : '查询成功'}</span> : null}
        </div>

        {summary ? (
          summary.error ? (
            <p className="error">{summary.error}</p>
          ) : (
            <div className="product-layout">
              {summary.imageUrl ? <img className="product-image" src={summary.imageUrl} alt="" /> : <div className="product-image placeholder">No image</div>}
              <div className="product-copy">
                <dl className="facts">
                  <div>
                    <dt>目录</dt>
                    <dd>{summary.catalogName ?? '未知目录'}</dd>
                  </div>
                  <div>
                    <dt>价格</dt>
                    <dd>{summary.price ?? '未提供'}</dd>
                  </div>
                  <div>
                    <dt>库存</dt>
                    <dd>{summary.availability ?? '未提供'}</dd>
                  </div>
                  <div>
                    <dt>返回数量</dt>
                    <dd>{summary.entryCount ?? 0} 条</dd>
                  </div>
                </dl>
                {summary.productUrl ? (
                  <a className="secondary-action" href={summary.productUrl} target="_blank" rel="noreferrer">
                    打开商品页面
                  </a>
                ) : null}
              </div>
            </div>
          )
        ) : (
          <p className="empty">点击“一键试查鞋子”，或让 Chrome WebMCP 按上面的分步工具查询。</p>
        )}
      </section>

      <section className="two-column">
        <article className="panel">
          <h2>快捷演示请求</h2>
          <p>普通用户想快速看到结果时，可以让 AI 调用这个组合工具：</p>
          <code>{shortcutTool.tool}</code>
          <pre>{JSON.stringify(exampleInput, null, 2)}</pre>
        </article>

        <article className="panel">
          <h2>本页已注册的工具</h2>
          {metadataError ? <p className="error">{metadataError}</p> : null}
          {!metadataError && mcpTools.length === 0 ? <p className="empty">正在加载工具列表...</p> : null}
          <ul className="tool-list compact">
            {webMcp.tools.map((tool) => (
              <li key={tool}>{friendlyToolName(tool)}</li>
            ))}
          </ul>
        </article>
      </section>

      <section className="panel technical-panel">
        <h2>技术记录</h2>
        {latest ? (
          <pre>{JSON.stringify(latest, null, 2)}</pre>
        ) : (
          <p className="empty">还没有调用记录。</p>
        )}
      </section>

      <section className="panel technical-panel">
        <h2>历史调用</h2>
        {history.length ? (
          <ol className="history">
            {history.map((record) => (
              <li key={record.id}>
                <strong>{record.toolName}</strong>
                <span>{new Date(record.createdAt).toLocaleTimeString()}</span>
                {record.error ? <em>{record.error}</em> : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="empty">通过 WebMCP 或按钮发起的调用会出现在这里。</p>
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
            <div className="section-heading">
              <div>
                <p className="eyebrow">使用说明</p>
                <h2 id="help-title">如何让浏览器 AI 使用这个页面</h2>
              </div>
              <button className="close-action" onClick={() => setHelpOpen(false)} aria-label="关闭使用说明">
                ×
              </button>
            </div>

            <div className="help-grid">
              <article>
                <h3>先确认 Chrome 已启用 WebMCP</h3>
                <ol>
                  {chromeSetupSteps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </article>

              <article>
                <h3>然后这样告诉 agent</h3>
                <p>把下面这段话交给支持 WebMCP 的 agent，它会先找 Catalog，再进入 Catalog 检索。</p>
                <pre>{agentPromptExample}</pre>
              </article>
            </div>

              <p className="help-note">
                如果 agent 没有自动调用工具，请明确说“使用当前页面的 WebMCP 工具”，并要求它按
              <code>{'search_catalogs -> inspect_catalog -> query_catalog -> resolve_catalog_entry'}</code>
                的顺序处理；只想快速演示时再使用
                <code>{shortcutTool.tool}</code>。
              </p>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function summarizeLatestCall(record: DemoCallRecord) {
  if (record.error) return { title: record.toolName, error: record.error };

  const result = record.result as { structuredContent?: Record<string, unknown> } | undefined;
  const content = result?.structuredContent;
  const error = content?.error as { message?: string } | undefined;
  if (error) return { title: record.toolName, error: error.message ?? '查询失败' };

  const selectedCatalog = content?.selected_catalog as Record<string, unknown> | undefined;
  const queryResult = content?.query_result as { entries?: Array<Record<string, unknown>> } | undefined;
  const entries = queryResult?.entries ?? [];
  const firstEntry = entries[0];
  const attributes = firstEntry?.attributes as Record<string, unknown> | undefined;

  return {
    title: typeof firstEntry?.title === 'string' ? firstEntry.title : record.toolName,
    catalogName: typeof selectedCatalog?.catalog_name === 'string' ? selectedCatalog.catalog_name : undefined,
    entryCount: entries.length,
    price: formatPrice(attributes?.amount, attributes?.currency),
    availability: typeof attributes?.availability_status === 'string' ? attributes.availability_status.replaceAll('_', ' ') : undefined,
    imageUrl: typeof attributes?.primary_image_url === 'string' ? attributes.primary_image_url : undefined,
    productUrl: typeof attributes?.product_url === 'string' ? attributes.product_url : undefined,
  };
}

function formatPrice(amount: unknown, currency: unknown) {
  if (typeof amount !== 'number' || typeof currency !== 'string') return undefined;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

function friendlyToolName(toolName: string) {
  const labels: Record<string, string> = {
    'ocp.mcp.get_page_state': '读取页面状态',
    'ocp.mcp.describe_ocp_catalog': '了解 OCP Catalog 是什么',
    'ocp.mcp.search_catalogs': '寻找可用目录',
    'ocp.mcp.inspect_catalog': '查看目录支持什么查询',
    'ocp.mcp.query_catalog': '查询指定目录',
    'ocp.mcp.resolve_catalog_entry': '查看某个结果的详情',
    'ocp.mcp.find_and_query_catalog': '自动找目录并查询商品',
  };

  return labels[toolName] ?? toolName;
}
