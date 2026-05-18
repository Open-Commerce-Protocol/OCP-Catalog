/**
 * Internal admin endpoints. Protected by `x-admin-key`. Useful for probing
 * the upstream Shopify endpoint and observing the bridge in isolation. Not
 * part of the OCP protocol surface.
 */
import { Elysia, t } from 'elysia';
import type { ShopifyConfig } from '../config';
import { mapProductToCommercialObject } from '../mapper/product-to-object';
import type { ShopifyCatalogClient } from '../shopify/mcp-client';
import { sourceId } from '../catalog/manifest';

interface AdminDeps {
  shopify: ShopifyCatalogClient;
  cfg: ShopifyConfig;
}

function isAuthorized(headers: Record<string, string | undefined>, expected: string): boolean {
  return headers['x-admin-key'] === expected;
}

function unauthorized(set: { status?: number | string }) {
  set.status = 401;
  return { error: { code: 'unauthorized', message: 'Invalid or missing x-admin-key' } };
}

export function createAdminRoutes(deps: AdminDeps) {
  return new Elysia({ prefix: '/admin' })
    .post(
      '/probe-query',
      async ({ body, headers, set }) => {
        if (!isAuthorized(headers, deps.cfg.SHOPIFY_CATALOG_ADMIN_KEY)) return unauthorized(set);

        const upstream = await deps.shopify.search({
          query: body?.q ?? '',
          filters: body?.available !== undefined ? { available: body.available } : undefined,
        });

        const sid = sourceId(deps.cfg);
        const objects = (upstream.products ?? []).map((p) =>
          mapProductToCommercialObject(p, {
            sourceId: sid,
            catalogBaseUrl: deps.cfg.SHOPIFY_CATALOG_PUBLIC_BASE_URL,
          }),
        );

        return {
          source_id: sid,
          total: upstream.products?.length ?? 0,
          ucp_capabilities: upstream.ucp?.capabilities ?? null,
          pagination: upstream.pagination ?? null,
          objects,
        };
      },
      {
        body: t.Optional(
          t.Object({
            q: t.Optional(t.String()),
            available: t.Optional(t.Boolean()),
          }),
        ),
      },
    )
    .post(
      '/probe-product',
      async ({ body, headers, set }) => {
        if (!isAuthorized(headers, deps.cfg.SHOPIFY_CATALOG_ADMIN_KEY)) return unauthorized(set);

        const upstream = await deps.shopify.getProduct({ id: body.id });
        return {
          source_id: sourceId(deps.cfg),
          product: upstream.product,
          ucp_capabilities: upstream.ucp?.capabilities ?? null,
        };
      },
      {
        body: t.Object({ id: t.String() }),
      },
    )
    .get('/stats', ({ headers, set }) => {
      if (!isAuthorized(headers, deps.cfg.SHOPIFY_CATALOG_ADMIN_KEY)) return unauthorized(set);
      return {
        catalog_id: deps.cfg.SHOPIFY_CATALOG_ID,
        mode: deps.cfg.SHOPIFY_CATALOG_MODE,
        mock: deps.cfg.SHOPIFY_MOCK,
        endpoint: deps.cfg.SHOPIFY_RESOLVED_ENDPOINT,
      };
    });
}
