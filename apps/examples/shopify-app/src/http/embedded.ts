/**
 * Minimal embedded landing page served at GET /app.
 *
 * A production App-Store app would render a full Polaris + App Bridge React UI
 * here. For this reference backend we serve a tiny App Bridge bootstrap page
 * that shows install/sync status. It is enough to satisfy the "redirect to app
 * UI after install" requirement and to eyeball state during development.
 */
import { Elysia } from 'elysia';
import type { ShopifyAppConfig } from '../config';
import type { InstallationStore } from '../store/installation-store';

export function createEmbeddedRoutes(deps: { cfg: ShopifyAppConfig; store: InstallationStore }) {
  return new Elysia().get('/app', async ({ query, set }) => {
    const shop = typeof query.shop === 'string' ? query.shop : '';
    const install = shop ? await deps.store.get(shop) : null;
    set.headers['content-type'] = 'text/html; charset=utf-8';
    const lastRun = install?.lastRun ? JSON.stringify(install.lastRun) : '—';
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OCP Provider Adapter</title>
  <!-- App Bridge would be loaded here in a real embedded app:
       <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" data-api-key="${deps.cfg.SHOPIFY_APP_API_KEY}"></script> -->
  <style>
    body { font: 15px/1.5 system-ui, sans-serif; margin: 2rem; color: #1a1a1a; }
    .card { max-width: 640px; border: 1px solid #e1e3e5; border-radius: 12px; padding: 1.5rem; }
    .badge { display: inline-block; padding: 2px 10px; border-radius: 999px; background: #e3f1df; color: #0c5132; font-size: 13px; }
    code { background: #f1f1f1; padding: 1px 5px; border-radius: 4px; }
    h1 { font-size: 20px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>OCP Provider Adapter</h1>
    ${install
      ? `<p><span class="badge">${install.status}</span> connected to <code>${shop}</code></p>
         <p>This store syncs its products into the OCP Catalog so AI shopping agents can discover them.</p>
         <ul>
           <li>Provider id: <code>${install.providerId}</code></li>
           <li>Registration version: <code>${install.activeRegistrationVersion ?? '—'}</code></li>
           <li>Last synced at: <code>${install.lastSyncedAt ?? '—'}</code></li>
           <li>Last run: <code>${lastRun}</code></li>
         </ul>`
      : `<p>No installation found${shop ? ` for <code>${shop}</code>` : ''}. Install the app from the Shopify admin to begin syncing.</p>`}
  </div>
</body>
</html>`;
  });
}
