import { describe, expect, test } from 'bun:test';
import { queryCatalogTool } from './query-catalog';
import { resolveCatalogEntryTool } from './resolve-catalog-entry';
import { createToolDeps, manifest, queryResult, resolvedReference, validRouteHint } from '../test-fixtures';
import type { ResolveRequest } from '@ocp-catalog/ocp-schema';

describe('query and resolve tools', () => {
  test('query_catalog rejects unsupported query packs', async () => {
    await expect(queryCatalogTool({
      route_hint: validRouteHint,
      query_pack: 'ocp.query.fake.v1',
      query: 'headphones',
    }, createToolDeps())).rejects.toMatchObject({ code: 'invalid_query_pack' });
  });

  test('query_catalog rejects unsupported filter fields', async () => {
    await expect(queryCatalogTool({
      route_hint: validRouteHint,
      query_pack: 'ocp.query.keyword.v1',
      query: 'headphones',
      filters: {
        seller: 'unsupported',
      },
    }, createToolDeps())).rejects.toMatchObject({ code: 'invalid_filter_field' });
  });

  test('query_catalog forwards a valid keyword request and normalizes results', async () => {
    const result = await queryCatalogTool({
      route_hint: validRouteHint,
      query_pack: 'ocp.query.keyword.v1',
      query: 'wireless headphones',
      filters: {
        category: 'electronics',
      },
      limit: 10,
      explain: true,
    }, createToolDeps());

    expect(result.entries[0]).toMatchObject({
      entry_id: 'entry_1',
      title: 'Demo Headphones',
    });
    expect(result.page.limit).toBe(10);
  });

  test('query_catalog deterministically selects a query pack when omitted', async () => {
    let forwardedQueryPack: string | undefined;
    const deps = createToolDeps();
    deps.catalogClient.getManifest = async () => manifest;
    deps.catalogClient.query = async (_url, body) => {
      forwardedQueryPack = body.query_pack;
      return {
        ...queryResult,
        query_pack: body.query_pack,
        query_mode: 'keyword',
        policy_summary: {
          query_mode: 'keyword',
          selected_query_pack: body.query_pack,
          supports_explain: true,
          accepted_filters: [],
          rejected_filters: [],
          warnings: [],
        },
        audit_id: 'qaudit_1',
      };
    };

    const result = await queryCatalogTool({
      route_hint: {
        ...validRouteHint,
        manifest_url: 'http://localhost:4000/ocp/manifest-select-pack',
      },
      query: 'wireless headphones',
    }, deps);

    expect(forwardedQueryPack).toBe('ocp.query.keyword.v1');
    expect(result.query_pack).toBe('ocp.query.keyword.v1');
    expect(result.query_mode).toBe('keyword');
    expect(result.policy_summary.selected_query_pack).toBe('ocp.query.keyword.v1');
    expect(result.audit_id).toBe('qaudit_1');
  });

  test('query_catalog disables explain when the selected capability does not support it', async () => {
    let forwardedExplain: boolean | undefined;
    const noExplainManifest = {
      ...manifest,
      query_capabilities: manifest.query_capabilities.map((capability) => ({
        ...capability,
        supports_explain: false,
      })),
    };
    const deps = createToolDeps();
    deps.catalogClient.getManifest = async () => noExplainManifest;
    deps.catalogClient.query = async (_url, body) => {
      forwardedExplain = body.explain;
      return {
        ...queryResult,
        explain: [],
      };
    };

    const result = await queryCatalogTool({
      route_hint: {
        ...validRouteHint,
        manifest_url: 'http://localhost:4000/ocp/manifest-no-explain',
      },
      query_pack: 'ocp.query.keyword.v1',
      query: 'wireless headphones',
      explain: true,
    }, deps);

    expect(forwardedExplain).toBe(false);
    expect(result.policy_summary.supports_explain).toBe(false);
    expect(result.policy_summary.warnings).toContain('Selected query capability does not support explain output.');
  });

  test('resolve_catalog_entry returns resolved attributes and actions', async () => {
    let forwardedRequest: ResolveRequest | undefined;
    const deps = createToolDeps();
    deps.catalogClient.resolve = async (_resolveUrl, body) => {
      forwardedRequest = body;
      return resolvedReference;
    };

    const result = await resolveCatalogEntryTool({
      route_hint: validRouteHint,
      entry_id: 'entry_1',
      purpose: 'checkout',
      live_check: true,
      requested_fields: ['availability_status'],
    }, deps);

    expect(forwardedRequest).toMatchObject({
      catalog_id: 'cat_local_dev',
      entry_id: 'entry_1',
      purpose: 'checkout',
      live_check: true,
      requested_fields: ['availability_status'],
    });
    expect(result.entry_id).toBe('entry_1');
    expect(result.purpose).toBe('checkout');
    expect(result.live_check).toBe(true);
    expect(result.requested_fields).toEqual(['availability_status']);
    expect(result.access?.permission_state).toBe('granted');
    expect(result.live_checks[0]?.check_id).toBe('availability');
    expect(result.actions[0]?.action_id).toBe('view_product');
    expect(result.actions[0]?.entrypoint.url).toBe('https://example.test/product');
  });
});
