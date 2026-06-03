/**
 * Embedded merchant dashboard served at GET /app, plus a JSON feed at
 * GET /app/dashboard.json that the page (and any future Polaris/App Bridge UI)
 * reads. The page server-renders the dashboard cards so it works with no
 * client JS; the JSON endpoint exists for richer front-ends later.
 *
 * Dashboard data (P1 + P2) is assembled by DashboardService:
 *   P1 — listing count, quality tiers, stock/image health, last sync, catalog.
 *   P2 — agent views (catalog.queried) and resolves (catalog.resolved).
 */
import { Elysia } from 'elysia';
import type { ShopifyAppConfig } from '../config';
import type { DashboardData, DashboardService } from '../services/dashboard-service';
import type { InstallationStore } from '../store/installation-store';

export interface EmbeddedDeps {
  cfg: ShopifyAppConfig;
  store: InstallationStore;
  dashboard: DashboardService;
}

export function createEmbeddedRoutes(deps: EmbeddedDeps) {
  return new Elysia()
    .get('/app/dashboard.json', async ({ query, set }) => {
      const shop = typeof query.shop === 'string' ? query.shop : '';
      if (!shop) {
        set.status = 400;
        return { error: { code: 'missing_shop', message: 'shop query param required' } };
      }
      const hours = Number(query.hours);
      const data = await deps.dashboard.build(shop, { hours: Number.isFinite(hours) ? hours : undefined });
      if (!data) {
        set.status = 404;
        return { error: { code: 'not_installed', message: `no installation for ${shop}` } };
      }
      return data;
    })
    .get('/app', async ({ query, set }) => {
      const shop = typeof query.shop === 'string' ? query.shop : '';
      set.headers['content-type'] = 'text/html; charset=utf-8';
      const data = shop ? await deps.dashboard.build(shop) : null;
      return renderDashboardPage(deps.cfg, shop, data);
    });
}

function metric(label: string, value: string | number | null, hint?: string): string {
  const v = value === null || value === undefined ? '&mdash;' : escapeHtml(String(value));
  return `<div class="metric"><div class="num">${v}</div><div class="lbl">${escapeHtml(label)}</div>${
    hint ? `<div class="hint">${escapeHtml(hint)}</div>` : ''
  }</div>`;
}

function renderDashboardPage(cfg: ShopifyAppConfig, shop: string, data: DashboardData | null): string {
  const safeShop = escapeHtml(shop);
  const body = data ? renderConnected(data) : renderNotConnected(safeShop);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OCP Provider Adapter</title>
  <!-- A production App-Store build loads App Bridge + Polaris here:
       <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" data-api-key="${escapeHtml(cfg.SHOPIFY_APP_API_KEY)}"></script> -->
  <style>
    body { font: 15px/1.5 system-ui, sans-serif; margin: 2rem; color: #1a1a1a; background: #f6f6f7; }
    .wrap { max-width: 820px; margin: 0 auto; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    .sub { color: #6d7175; margin: 0 0 20px; }
    .card { background: #fff; border: 1px solid #e1e3e5; border-radius: 12px; padding: 1.25rem 1.5rem; margin-bottom: 16px; }
    .card h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .04em; color: #6d7175; margin: 0 0 14px; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
    .grid3 { grid-template-columns: repeat(3, 1fr); }
    .metric { background: #f9fafb; border: 1px solid #ececec; border-radius: 10px; padding: 12px; text-align: center; }
    .metric .num { font-size: 26px; font-weight: 650; }
    .metric .lbl { font-size: 12px; color: #6d7175; margin-top: 2px; }
    .metric .hint { font-size: 11px; color: #8c9196; margin-top: 4px; }
    .badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 13px; }
    .ok { background: #e3f1df; color: #0c5132; }
    .warn { background: #fff1e3; color: #5c3d00; }
    code { background: #f1f1f1; padding: 1px 5px; border-radius: 4px; }
    .muted { color: #8c9196; font-size: 13px; }
  </style>
</head>
<body><div class="wrap">${body}</div></body>
</html>`;
}

function renderConnected(d: DashboardData): string {
  const statusClass = d.connected ? 'ok' : 'warn';
  const lastSync = d.last_synced_at ? new Date(d.last_synced_at).toLocaleString() : '—';
  const lastRun = d.last_run ?? {};
  const runStatus = typeof lastRun.status === 'string' ? lastRun.status : '—';
  const runType = typeof lastRun.type === 'string' ? lastRun.type : '—';

  const activityCard = d.activity.available
    ? `<div class="card">
         <h2>Agent activity${d.activity.window_hours ? ` · last ${Math.round(d.activity.window_hours / 24)}d` : ''}</h2>
         <div class="grid grid3">
           ${metric('Views', d.activity.views, 'appeared in agent search')}
           ${metric('Resolves', d.activity.resolves, 'agent opened the entry')}
           ${metric('Conversions', null, 'coming soon')}
         </div>
       </div>`
    : `<div class="card"><h2>Agent activity</h2>
         <p class="muted">Activity metrics (views / resolves) are not wired in this deployment.
         Set <code>SHOPIFY_APP_ACTIVITY_BASE_URL</code> to enable them.</p></div>`;

  return `
    <h1>OCP Provider Adapter</h1>
    <p class="sub"><span class="badge ${statusClass}">${escapeHtml(d.status ?? 'unknown')}</span>
      &nbsp;<code>${escapeHtml(d.shop_domain)}</code> → catalog <code>${escapeHtml(d.catalog_id ?? '—')}</code></p>

    <div class="card">
      <h2>Listing on OCP</h2>
      <div class="grid">
        ${metric('Products listed', d.listing.object_count)}
        ${metric('Active', d.listing.active_entry_count)}
        ${metric('Rich quality', d.listing.rich_entry_count, 'full data')}
        ${metric('Out of stock', d.listing.out_of_stock_count)}
        ${metric('Missing image', d.listing.missing_image_count)}
        ${metric('Missing URL', d.listing.missing_product_url_count)}
        ${metric('Standard', d.listing.standard_entry_count)}
        ${metric('Basic', d.listing.basic_entry_count)}
      </div>
    </div>

    ${activityCard}

    <div class="card">
      <h2>Sync status</h2>
      <ul>
        <li>Provider id: <code>${escapeHtml(d.provider_id)}</code></li>
        <li>Registration version: <code>${escapeHtml(String(d.active_registration_version ?? '—'))}</code></li>
        <li>Last sync: <code>${escapeHtml(lastSync)}</code></li>
        <li>Last run: <code>${escapeHtml(runType)}</code> · <code>${escapeHtml(runStatus)}</code></li>
      </ul>
      <p class="muted">Products sync automatically on every change via webhooks.</p>
    </div>`;
}

function renderNotConnected(safeShop: string): string {
  return `
    <h1>OCP Provider Adapter</h1>
    <div class="card">
      <p>No installation found${safeShop ? ` for <code>${safeShop}</code>` : ''}.</p>
      <p class="muted">Install the app from your Shopify admin to start syncing your products into the OCP Catalog.</p>
    </div>`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
