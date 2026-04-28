# OCP MCP Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new `apps/ocp-mcp-server` runtime that lets agents discover catalogs through the Registration node, inspect a selected catalog, query it, and resolve selected entries through MCP over `stdio`.

**Architecture:** Add a dedicated MCP gateway app instead of embedding MCP into `ocp-registration-api`. The app will reuse shared config loading, call existing OCP HTTP endpoints through focused client modules, enforce manifest-aware query guardrails, and expose five task-oriented MCP tools.

**Tech Stack:** Bun, TypeScript, `@modelcontextprotocol/sdk`, shared `@ocp-catalog/config`, native `fetch`, Bun test

---

## File Structure

### New files

- `apps/ocp-mcp-server/package.json`
- `apps/ocp-mcp-server/tsconfig.json`
- `apps/ocp-mcp-server/README.md`
- `apps/ocp-mcp-server/src/index.ts`
- `apps/ocp-mcp-server/src/config.ts`
- `apps/ocp-mcp-server/src/errors.ts`
- `apps/ocp-mcp-server/src/server.ts`
- `apps/ocp-mcp-server/src/schemas/tool-inputs.ts`
- `apps/ocp-mcp-server/src/ocp/cache.ts`
- `apps/ocp-mcp-server/src/ocp/http.ts`
- `apps/ocp-mcp-server/src/ocp/registration-client.ts`
- `apps/ocp-mcp-server/src/ocp/catalog-client.ts`
- `apps/ocp-mcp-server/src/ocp/route-hints.ts`
- `apps/ocp-mcp-server/src/ocp/manifest.ts`
- `apps/ocp-mcp-server/src/ocp/selection.ts`
- `apps/ocp-mcp-server/src/tools/search-catalogs.ts`
- `apps/ocp-mcp-server/src/tools/inspect-catalog.ts`
- `apps/ocp-mcp-server/src/tools/query-catalog.ts`
- `apps/ocp-mcp-server/src/tools/resolve-catalog-entry.ts`
- `apps/ocp-mcp-server/src/tools/find-and-query-catalog.ts`
- `apps/ocp-mcp-server/src/selection.test.ts`
- `apps/ocp-mcp-server/src/tools/search-catalogs.test.ts`
- `apps/ocp-mcp-server/src/tools/query-catalog.test.ts`
- `scripts/validate-mcp-gateway.ts`

### Modified files

- `package.json`
- `.env.example`
- `packages/config/src/env-schema.ts`
- `packages/config/src/index.test.ts`

### Responsibility map

- shared config stays in `packages/config`
- HTTP wire logic stays in `src/ocp/*`
- tool orchestration stays in `src/tools/*`
- transport wiring stays in `src/server.ts`
- smoke validation stays in `scripts/validate-mcp-gateway.ts`

---

### Task 1: Scaffold the MCP app and shared configuration

**Files:**
- Create: `apps/ocp-mcp-server/package.json`
- Create: `apps/ocp-mcp-server/tsconfig.json`
- Create: `apps/ocp-mcp-server/src/index.ts`
- Create: `apps/ocp-mcp-server/src/config.ts`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `packages/config/src/env-schema.ts`
- Modify: `packages/config/src/index.test.ts`

- [ ] **Step 1: Write the failing config test for new MCP env vars**

```ts
test('reads MCP gateway defaults from explicit env', () => {
  const config = loadConfig({
    OCP_MCP_DEFAULT_REGISTRATION_URL: 'http://localhost:4100',
    OCP_MCP_REQUEST_TIMEOUT_MS: '15000',
    OCP_MCP_USER_AGENT: 'ocp-mcp-server/test',
    OCP_MCP_API_KEY: 'gateway-key',
  });

  expect(config.OCP_MCP_DEFAULT_REGISTRATION_URL).toBe('http://localhost:4100');
  expect(config.OCP_MCP_REQUEST_TIMEOUT_MS).toBe(15000);
  expect(config.OCP_MCP_USER_AGENT).toBe('ocp-mcp-server/test');
  expect(config.OCP_MCP_API_KEY).toBe('gateway-key');
});
```

- [ ] **Step 2: Run the config test to verify it fails**

Run: `bun test packages/config/src/index.test.ts`

Expected: FAIL because the new `OCP_MCP_*` fields do not exist on `AppConfig`.

- [ ] **Step 3: Add shared config support and environment docs**

```ts
// packages/config/src/env-schema.ts
export const envSchema = z.object({
  // existing fields...
  OCP_MCP_DEFAULT_REGISTRATION_URL: z.string().url().default('http://localhost:4100'),
  OCP_MCP_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).default(10000),
  OCP_MCP_USER_AGENT: z.string().default('ocp-mcp-server/0.1.0'),
  OCP_MCP_API_KEY: z.string().default(''),
});
```

```dotenv
# .env.example
OCP_MCP_DEFAULT_REGISTRATION_URL=http://localhost:4100
OCP_MCP_REQUEST_TIMEOUT_MS=10000
OCP_MCP_USER_AGENT=ocp-mcp-server/0.1.0
OCP_MCP_API_KEY=
```

- [ ] **Step 4: Scaffold the new app and root scripts**

```json
// apps/ocp-mcp-server/package.json
{
  "name": "@ocp-catalog/ocp-mcp-server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "cd ../.. && bun --watch apps/ocp-mcp-server/src/index.ts",
    "start": "cd ../.. && bun apps/ocp-mcp-server/src/index.ts",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "build": "bun build src/index.ts --outdir dist --target bun",
    "lint": "tsc -p tsconfig.json --noEmit",
    "test": "bun test"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.17.4",
    "@ocp-catalog/config": "workspace:*",
    "zod": "^4.1.12"
  }
}
```

```json
// package.json
{
  "scripts": {
    "mcp:gateway": "bun run --cwd apps/ocp-mcp-server start",
    "validate:mcp": "bun scripts/validate-mcp-gateway.ts"
  }
}
```

```ts
// apps/ocp-mcp-server/src/config.ts
import { loadConfig } from '@ocp-catalog/config';

export type McpGatewayConfig = ReturnType<typeof loadConfig>;

export function loadMcpGatewayConfig() {
  return loadConfig();
}
```

- [ ] **Step 5: Add a minimal executable entrypoint**

```ts
// apps/ocp-mcp-server/src/index.ts
import { loadMcpGatewayConfig } from './config';
import { startMcpServer } from './server';

const config = loadMcpGatewayConfig();

await startMcpServer(config);
```

- [ ] **Step 6: Run targeted tests and typecheck**

Run:

```bash
bun test packages/config/src/index.test.ts
bun run --cwd apps/ocp-mcp-server typecheck
```

Expected:

- config tests PASS
- app typecheck fails only because `server.ts` is not implemented yet

- [ ] **Step 7: Commit**

```bash
git add package.json .env.example packages/config/src/env-schema.ts packages/config/src/index.test.ts apps/ocp-mcp-server
git commit -m "feat: scaffold OCP MCP gateway app"
```

---

### Task 2: Build the shared HTTP, cache, route-hint, and manifest helpers

**Files:**
- Create: `apps/ocp-mcp-server/src/errors.ts`
- Create: `apps/ocp-mcp-server/src/ocp/cache.ts`
- Create: `apps/ocp-mcp-server/src/ocp/http.ts`
- Create: `apps/ocp-mcp-server/src/ocp/registration-client.ts`
- Create: `apps/ocp-mcp-server/src/ocp/catalog-client.ts`
- Create: `apps/ocp-mcp-server/src/ocp/route-hints.ts`
- Create: `apps/ocp-mcp-server/src/ocp/manifest.ts`

- [ ] **Step 1: Write focused tests for route-hint resolution and manifest validation**

```ts
// future file: apps/ocp-mcp-server/src/tools/search-catalogs.test.ts
test('resolves route hint from catalog id through registration resolve endpoint', async () => {
  const registration = createStubRegistrationClient({
    resolveResult: {
      catalog_id: 'cat_local_dev',
      route_hint: {
        catalog_id: 'cat_local_dev',
        manifest_url: 'http://localhost:4000/ocp/manifest',
        query_url: 'http://localhost:4000/ocp/query',
        resolve_url: 'http://localhost:4000/ocp/resolve',
      },
    },
  });

  const routeHint = await resolveRouteHint({
    catalogId: 'cat_local_dev',
    registrationBaseUrl: 'http://localhost:4100',
    registrationClient: registration,
  });

  expect(routeHint.query_url).toBe('http://localhost:4000/ocp/query');
});
```

```ts
test('rejects route hints missing query or resolve endpoints', async () => {
  await expect(loadCatalogManifest({
    routeHint: {
      catalog_id: 'broken',
      manifest_url: 'http://localhost:4000/ocp/manifest',
      query_url: '',
      resolve_url: '',
    },
    catalogClient: createStubCatalogClient(),
  })).rejects.toMatchObject({ code: 'catalog_manifest_unavailable' });
});
```

- [ ] **Step 2: Run the route-hint tests to verify they fail**

Run: `bun test apps/ocp-mcp-server/src/tools/search-catalogs.test.ts`

Expected: FAIL because the helper modules and error types do not exist.

- [ ] **Step 3: Implement structured gateway errors and HTTP wrapper**

```ts
// apps/ocp-mcp-server/src/errors.ts
export class McpToolError extends Error {
  constructor(
    readonly code:
      | 'configuration_error'
      | 'registration_unavailable'
      | 'catalog_not_found'
      | 'catalog_manifest_unavailable'
      | 'invalid_query_pack'
      | 'invalid_filter_field'
      | 'catalog_query_failed'
      | 'catalog_resolve_failed',
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
```

```ts
// apps/ocp-mcp-server/src/ocp/http.ts
export async function fetchJson<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    return await response.json() as T;
  } finally {
    clearTimeout(timeout);
  }
}
```

- [ ] **Step 4: Implement cache and OCP clients**

```ts
// apps/ocp-mcp-server/src/ocp/cache.ts
export class TtlCache<T> {
  private readonly values = new Map<string, { expiresAt: number; value: T }>();

  get(key: string) {
    const hit = this.values.get(key);
    if (!hit || Date.now() > hit.expiresAt) return null;
    return hit.value;
  }

  set(key: string, value: T, ttlMs: number) {
    this.values.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
}
```

```ts
// apps/ocp-mcp-server/src/ocp/registration-client.ts
export class RegistrationClient {
  async search(baseUrl: string, body: Record<string, unknown>) {
    return fetchJson(`${baseUrl}/ocp/catalogs/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }, this.timeoutMs);
  }

  async resolve(baseUrl: string, catalogId: string) {
    return fetchJson(`${baseUrl}/ocp/catalogs/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ catalog_id: catalogId }),
    }, this.timeoutMs);
  }
}
```

```ts
// apps/ocp-mcp-server/src/ocp/catalog-client.ts
export class CatalogClient {
  async getManifest(manifestUrl: string) {
    return fetchJson(manifestUrl, { method: 'GET' }, this.timeoutMs);
  }

  async query(queryUrl: string, body: Record<string, unknown>, apiKey?: string) {
    return fetchJson(queryUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { 'x-api-key': apiKey } : {}),
      },
      body: JSON.stringify(body),
    }, this.timeoutMs);
  }

  async resolve(resolveUrl: string, body: Record<string, unknown>) {
    return fetchJson(resolveUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }, this.timeoutMs);
  }
}
```

- [ ] **Step 5: Implement route-hint and manifest helpers**

```ts
// apps/ocp-mcp-server/src/ocp/route-hints.ts
export async function resolveRouteHint(args: {
  routeHint?: Record<string, unknown>;
  catalogId?: string;
  registrationBaseUrl?: string;
  registrationClient: RegistrationClient;
}) {
  if (args.routeHint) return args.routeHint;
  if (!args.catalogId || !args.registrationBaseUrl) {
    throw new McpToolError('catalog_not_found', 'catalog_id requires registration_base_url');
  }

  const resolved = await args.registrationClient.resolve(args.registrationBaseUrl, args.catalogId);
  if (!resolved.route_hint?.query_url || !resolved.route_hint?.resolve_url || !resolved.route_hint?.manifest_url) {
    throw new McpToolError('catalog_not_found', 'resolved route hint is missing required endpoints', {
      catalog_id: args.catalogId,
    });
  }

  return resolved.route_hint;
}
```

```ts
// apps/ocp-mcp-server/src/ocp/manifest.ts
export async function loadCatalogManifest(args: {
  routeHint: { manifest_url: string };
  catalogClient: CatalogClient;
}) {
  if (!args.routeHint.manifest_url) {
    throw new McpToolError('catalog_manifest_unavailable', 'route hint is missing manifest_url');
  }

  return args.catalogClient.getManifest(args.routeHint.manifest_url);
}
```

- [ ] **Step 6: Run the helper tests**

Run: `bun test apps/ocp-mcp-server/src/tools/search-catalogs.test.ts`

Expected: PASS for route-hint and manifest helper cases.

- [ ] **Step 7: Commit**

```bash
git add apps/ocp-mcp-server/src/errors.ts apps/ocp-mcp-server/src/ocp apps/ocp-mcp-server/src/tools/search-catalogs.test.ts
git commit -m "feat: add OCP MCP gateway clients and helpers"
```

---

### Task 3: Implement `search_catalogs` and `inspect_catalog`

**Files:**
- Create: `apps/ocp-mcp-server/src/schemas/tool-inputs.ts`
- Create: `apps/ocp-mcp-server/src/tools/search-catalogs.ts`
- Create: `apps/ocp-mcp-server/src/tools/inspect-catalog.ts`
- Modify: `apps/ocp-mcp-server/src/server.ts`
- Modify: `apps/ocp-mcp-server/src/tools/search-catalogs.test.ts`

- [ ] **Step 1: Write failing tool tests for search and inspect**

```ts
test('search_catalogs returns normalized candidate summaries', async () => {
  const result = await searchCatalogsTool({
    query: 'commerce product',
    registration_base_url: 'http://localhost:4100',
    limit: 5,
  }, deps);

  expect(result.registration_base_url).toBe('http://localhost:4100');
  expect(result.catalogs[0]).toMatchObject({
    catalog_id: 'cat_local_dev',
    query_url: 'http://localhost:4000/ocp/query',
  });
});
```

```ts
test('inspect_catalog summarizes manifest capabilities', async () => {
  const result = await inspectCatalogTool({
    route_hint: {
      catalog_id: 'cat_local_dev',
      manifest_url: 'http://localhost:4000/ocp/manifest',
      query_url: 'http://localhost:4000/ocp/query',
      resolve_url: 'http://localhost:4000/ocp/resolve',
    },
  }, deps);

  expect(result.catalog_id).toBe('cat_local_dev');
  expect(result.supported_query_packs).toContain('ocp.query.keyword.v1');
});
```

- [ ] **Step 2: Run the search and inspect tests to verify they fail**

Run: `bun test apps/ocp-mcp-server/src/tools/search-catalogs.test.ts`

Expected: FAIL because tool functions and MCP registration do not exist.

- [ ] **Step 3: Define tool input schemas**

```ts
// apps/ocp-mcp-server/src/schemas/tool-inputs.ts
import { z } from 'zod';

export const searchCatalogsInput = z.object({
  registration_base_url: z.string().url().optional(),
  query: z.string().min(1),
  filters: z.record(z.string(), z.any()).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  explain: z.boolean().optional(),
});

export const inspectCatalogInput = z.object({
  registration_base_url: z.string().url().optional(),
  catalog_id: z.string().min(1).optional(),
  route_hint: z.record(z.string(), z.any()).optional(),
}).refine((value) => value.catalog_id || value.route_hint, {
  message: 'catalog_id or route_hint is required',
});
```

- [ ] **Step 4: Implement the two tool modules**

```ts
// apps/ocp-mcp-server/src/tools/search-catalogs.ts
export async function searchCatalogsTool(input: SearchCatalogsInput, deps: ToolDeps) {
  const registrationBaseUrl = input.registration_base_url ?? deps.config.OCP_MCP_DEFAULT_REGISTRATION_URL;
  const result = await deps.registrationClient.search(registrationBaseUrl, {
    query: input.query,
    filters: input.filters ?? {},
    limit: input.limit ?? 10,
    explain: input.explain ?? false,
  });

  return {
    registration_base_url: registrationBaseUrl,
    catalogs: (result.items ?? []).map((item: any) => ({
      catalog_id: item.catalog_id,
      title: item.title ?? item.catalog_name ?? item.catalog_id,
      summary: item.summary ?? null,
      route_hint: item.route_hint,
      query_url: item.route_hint?.query_url ?? null,
      resolve_url: item.route_hint?.resolve_url ?? null,
      trust_tier: item.trust_tier ?? null,
      verification_status: item.verification_status ?? null,
      health_status: item.health_status ?? null,
    })),
  };
}
```

```ts
// apps/ocp-mcp-server/src/tools/inspect-catalog.ts
export async function inspectCatalogTool(input: InspectCatalogInput, deps: ToolDeps) {
  const routeHint = await resolveRouteHint({
    routeHint: input.route_hint,
    catalogId: input.catalog_id,
    registrationBaseUrl: input.registration_base_url ?? deps.config.OCP_MCP_DEFAULT_REGISTRATION_URL,
    registrationClient: deps.registrationClient,
  });

  const manifest = await loadCatalogManifest({ routeHint, catalogClient: deps.catalogClient });

  return {
    catalog_id: manifest.catalog_id ?? routeHint.catalog_id,
    manifest_url: routeHint.manifest_url,
    query_url: routeHint.query_url,
    resolve_url: routeHint.resolve_url,
    supported_query_packs: manifest.query_capability?.supported_query_packs ?? [],
    supported_query_modes: manifest.query_capability?.query_modes ?? [],
    supported_filter_fields: manifest.query_capability?.filter_fields ?? [],
    supported_query_languages: manifest.query_capability?.supported_query_languages ?? [],
    content_languages: manifest.content_languages ?? [],
  };
}
```

- [ ] **Step 5: Register the tools in the MCP server**

```ts
// apps/ocp-mcp-server/src/server.ts
server.registerTool(
  'search_catalogs',
  {
    title: 'Search OCP catalogs',
    description: 'Search the Registration node for matching catalogs.',
    inputSchema: searchCatalogsInput.shape,
  },
  async (args) => ({ content: [{ type: 'text', text: JSON.stringify(await searchCatalogsTool(args, deps), null, 2) }] }),
);

server.registerTool(
  'inspect_catalog',
  {
    title: 'Inspect an OCP catalog',
    description: 'Fetch route hint and manifest details for a selected catalog.',
    inputSchema: inspectCatalogInput.shape,
  },
  async (args) => ({ content: [{ type: 'text', text: JSON.stringify(await inspectCatalogTool(args, deps), null, 2) }] }),
);
```

- [ ] **Step 6: Run tool tests and app typecheck**

Run:

```bash
bun test apps/ocp-mcp-server/src/tools/search-catalogs.test.ts
bun run --cwd apps/ocp-mcp-server typecheck
```

Expected: PASS for search and inspect tool tests, with remaining typecheck failures only for not-yet-implemented query and resolve tools.

- [ ] **Step 7: Commit**

```bash
git add apps/ocp-mcp-server/src/schemas/tool-inputs.ts apps/ocp-mcp-server/src/tools/search-catalogs.ts apps/ocp-mcp-server/src/tools/inspect-catalog.ts apps/ocp-mcp-server/src/server.ts apps/ocp-mcp-server/src/tools/search-catalogs.test.ts
git commit -m "feat: add MCP catalog search and inspect tools"
```

---

### Task 4: Implement `query_catalog` and `resolve_catalog_entry`

**Files:**
- Create: `apps/ocp-mcp-server/src/tools/query-catalog.ts`
- Create: `apps/ocp-mcp-server/src/tools/resolve-catalog-entry.ts`
- Create: `apps/ocp-mcp-server/src/tools/query-catalog.test.ts`
- Modify: `apps/ocp-mcp-server/src/schemas/tool-inputs.ts`
- Modify: `apps/ocp-mcp-server/src/server.ts`

- [ ] **Step 1: Write failing tests for query pack and filter guardrails**

```ts
test('query_catalog rejects unsupported query packs', async () => {
  await expect(queryCatalogTool({
    route_hint: validRouteHint,
    query_pack: 'ocp.query.fake.v1',
    query: 'headphones',
  }, deps)).rejects.toMatchObject({ code: 'invalid_query_pack' });
});
```

```ts
test('query_catalog forwards a valid keyword request and normalizes results', async () => {
  const result = await queryCatalogTool({
    route_hint: validRouteHint,
    query_pack: 'ocp.query.keyword.v1',
    query: 'wireless headphones',
    filters: {},
    limit: 10,
    explain: true,
  }, deps);

  expect(result.entries[0]).toMatchObject({
    entry_id: 'entry_1',
    title: 'Demo Headphones',
  });
  expect(result.page.limit).toBe(10);
});
```

```ts
test('resolve_catalog_entry returns resolved attributes and actions', async () => {
  const result = await resolveCatalogEntryTool({
    route_hint: validRouteHint,
    entry_id: 'entry_1',
  }, deps);

  expect(result.entry_id).toBe('entry_1');
  expect(result.actions[0].action_type).toBe('view_product');
});
```

- [ ] **Step 2: Run the query tool tests to verify they fail**

Run: `bun test apps/ocp-mcp-server/src/tools/query-catalog.test.ts`

Expected: FAIL because query and resolve tool modules do not exist.

- [ ] **Step 3: Extend schemas and implement manifest-aware validation**

```ts
// apps/ocp-mcp-server/src/schemas/tool-inputs.ts
export const queryCatalogInput = z.object({
  registration_base_url: z.string().url().optional(),
  catalog_id: z.string().min(1).optional(),
  route_hint: z.record(z.string(), z.any()).optional(),
  query: z.string().min(1).optional(),
  filters: z.record(z.string(), z.any()).optional(),
  query_pack: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  offset: z.number().int().min(0).optional(),
  explain: z.boolean().optional(),
}).refine((value) => value.catalog_id || value.route_hint, {
  message: 'catalog_id or route_hint is required',
});

export const resolveCatalogEntryInput = z.object({
  registration_base_url: z.string().url().optional(),
  catalog_id: z.string().min(1).optional(),
  route_hint: z.record(z.string(), z.any()).optional(),
  entry_id: z.string().min(1),
}).refine((value) => value.catalog_id || value.route_hint, {
  message: 'catalog_id or route_hint is required',
});
```

```ts
// apps/ocp-mcp-server/src/tools/query-catalog.ts
function assertSupportedQueryPack(manifest: any, queryPack?: string) {
  const supported = manifest.query_capability?.supported_query_packs ?? [];
  if (queryPack && !supported.includes(queryPack)) {
    throw new McpToolError('invalid_query_pack', `unsupported query_pack: ${queryPack}`, { supported });
  }
}

function assertSupportedFilters(manifest: any, filters: Record<string, unknown>) {
  const supported = new Set(manifest.query_capability?.filter_fields ?? []);
  for (const key of Object.keys(filters)) {
    if (supported.size > 0 && !supported.has(key)) {
      throw new McpToolError('invalid_filter_field', `unsupported filter field: ${key}`, {
        field: key,
        supported: Array.from(supported),
      });
    }
  }
}
```

- [ ] **Step 4: Implement the query and resolve tools**

```ts
// apps/ocp-mcp-server/src/tools/query-catalog.ts
export async function queryCatalogTool(input: QueryCatalogInput, deps: ToolDeps) {
  const routeHint = await resolveRouteHint({
    routeHint: input.route_hint,
    catalogId: input.catalog_id,
    registrationBaseUrl: input.registration_base_url ?? deps.config.OCP_MCP_DEFAULT_REGISTRATION_URL,
    registrationClient: deps.registrationClient,
  });

  const manifest = await loadCatalogManifest({ routeHint, catalogClient: deps.catalogClient });
  assertSupportedQueryPack(manifest, input.query_pack);
  assertSupportedFilters(manifest, input.filters ?? {});

  const result = await deps.catalogClient.query(routeHint.query_url, {
    ocp_version: '1.0',
    kind: 'CatalogQueryRequest',
    catalog_id: manifest.catalog_id ?? routeHint.catalog_id,
    query_pack: input.query_pack,
    query: input.query,
    filters: input.filters ?? {},
    limit: input.limit ?? 10,
    offset: input.offset ?? 0,
    explain: input.explain ?? false,
  }, deps.config.OCP_MCP_API_KEY || undefined);

  return {
    catalog_id: manifest.catalog_id ?? routeHint.catalog_id,
    query_url: routeHint.query_url,
    entries: result.entries ?? [],
    page: result.page ?? { limit: input.limit ?? 10, offset: input.offset ?? 0, has_more: false },
    explain: result.explain ?? null,
  };
}
```

```ts
// apps/ocp-mcp-server/src/tools/resolve-catalog-entry.ts
export async function resolveCatalogEntryTool(input: ResolveCatalogEntryInput, deps: ToolDeps) {
  const routeHint = await resolveRouteHint({
    routeHint: input.route_hint,
    catalogId: input.catalog_id,
    registrationBaseUrl: input.registration_base_url ?? deps.config.OCP_MCP_DEFAULT_REGISTRATION_URL,
    registrationClient: deps.registrationClient,
  });

  const result = await deps.catalogClient.resolve(routeHint.resolve_url, {
    ocp_version: '1.0',
    kind: 'CatalogResolveRequest',
    entry_id: input.entry_id,
  });

  return {
    entry_id: input.entry_id,
    catalog_id: routeHint.catalog_id,
    resolved: result,
    actions: result.actions ?? [],
  };
}
```

- [ ] **Step 5: Register the new tools in the MCP server**

```ts
server.registerTool(
  'query_catalog',
  {
    title: 'Query an OCP catalog',
    description: 'Query a selected OCP catalog using manifest-supported capabilities.',
    inputSchema: queryCatalogInput.shape,
  },
  async (args) => ({ content: [{ type: 'text', text: JSON.stringify(await queryCatalogTool(args, deps), null, 2) }] }),
);

server.registerTool(
  'resolve_catalog_entry',
  {
    title: 'Resolve an OCP catalog entry',
    description: 'Resolve a selected OCP catalog entry into visible attributes and actions.',
    inputSchema: resolveCatalogEntryInput.shape,
  },
  async (args) => ({ content: [{ type: 'text', text: JSON.stringify(await resolveCatalogEntryTool(args, deps), null, 2) }] }),
);
```

- [ ] **Step 6: Run tool tests and typecheck**

Run:

```bash
bun test apps/ocp-mcp-server/src/tools/query-catalog.test.ts
bun run --cwd apps/ocp-mcp-server typecheck
```

Expected: PASS for query and resolve tests, with remaining failures only for the final high-level tool.

- [ ] **Step 7: Commit**

```bash
git add apps/ocp-mcp-server/src/tools/query-catalog.ts apps/ocp-mcp-server/src/tools/resolve-catalog-entry.ts apps/ocp-mcp-server/src/tools/query-catalog.test.ts apps/ocp-mcp-server/src/schemas/tool-inputs.ts apps/ocp-mcp-server/src/server.ts
git commit -m "feat: add MCP catalog query and resolve tools"
```

---

### Task 5: Implement selection policy, `find_and_query_catalog`, and stdio server startup

**Files:**
- Create: `apps/ocp-mcp-server/src/ocp/selection.ts`
- Create: `apps/ocp-mcp-server/src/tools/find-and-query-catalog.ts`
- Create: `apps/ocp-mcp-server/src/selection.test.ts`
- Modify: `apps/ocp-mcp-server/src/server.ts`

- [ ] **Step 1: Write failing selection policy tests**

```ts
test('selectBestCatalog prefers healthy verified catalogs', () => {
  const selected = selectBestCatalog([
    { catalog_id: 'degraded', health_status: 'degraded', verification_status: 'verified' },
    { catalog_id: 'healthy', health_status: 'healthy', verification_status: 'verified' },
  ]);

  expect(selected.catalog_id).toBe('healthy');
});
```

```ts
test('find_and_query_catalog searches then queries the chosen catalog', async () => {
  const result = await findAndQueryCatalogTool({
    registration_base_url: 'http://localhost:4100',
    catalog_query: 'commerce',
    query: 'running shoes',
    query_pack: 'ocp.query.keyword.v1',
  }, deps);

  expect(result.selected_catalog.catalog_id).toBe('cat_local_dev');
  expect(result.query_result.entries.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run the selection tests to verify they fail**

Run: `bun test apps/ocp-mcp-server/src/selection.test.ts`

Expected: FAIL because the selection policy and high-level tool do not exist.

- [ ] **Step 3: Implement deterministic catalog selection**

```ts
// apps/ocp-mcp-server/src/ocp/selection.ts
function scoreCatalog(candidate: any) {
  let score = 0;
  if (candidate.health_status === 'healthy') score += 100;
  if (candidate.verification_status === 'verified' || candidate.verification_status === 'not_required') score += 50;
  if (candidate.language_match === true) score += 25;
  if (candidate.domain_match === true) score += 25;
  return score;
}

export function selectBestCatalog(candidates: any[]) {
  if (candidates.length === 0) {
    throw new McpToolError('catalog_not_found', 'no catalogs matched the search request');
  }

  return [...candidates]
    .map((candidate, index) => ({ candidate, index, score: scoreCatalog(candidate) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)[0]!.candidate;
}
```

- [ ] **Step 4: Implement the high-level tool and stdio transport**

```ts
// apps/ocp-mcp-server/src/tools/find-and-query-catalog.ts
export async function findAndQueryCatalogTool(input: FindAndQueryCatalogInput, deps: ToolDeps) {
  const searchResult = await searchCatalogsTool({
    registration_base_url: input.registration_base_url,
    query: input.catalog_query,
    filters: input.catalog_filters,
    limit: input.limit ?? 10,
    explain: false,
  }, deps);

  const selectedCatalog = selectBestCatalog(searchResult.catalogs);
  const queryResult = await queryCatalogTool({
    route_hint: selectedCatalog.route_hint,
    query: input.query,
    filters: input.filters,
    query_pack: input.query_pack,
    limit: input.limit,
    explain: true,
  }, deps);

  return {
    registration_base_url: searchResult.registration_base_url,
    selected_catalog: selectedCatalog,
    query_result: queryResult,
  };
}
```

```ts
// apps/ocp-mcp-server/src/server.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

export async function startMcpServer(config: McpGatewayConfig) {
  const server = new McpServer({
    name: 'ocp-mcp-server',
    version: '0.1.0',
  });

  // register all five tools here

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
```

- [ ] **Step 5: Register `find_and_query_catalog` and verify process startup**

```ts
server.registerTool(
  'find_and_query_catalog',
  {
    title: 'Find and query an OCP catalog',
    description: 'Search candidate catalogs, choose one, and issue a query in one tool call.',
    inputSchema: findAndQueryCatalogInput.shape,
  },
  async (args) => ({ content: [{ type: 'text', text: JSON.stringify(await findAndQueryCatalogTool(args, deps), null, 2) }] }),
);
```

Run:

```bash
bun test apps/ocp-mcp-server/src/selection.test.ts
bun run --cwd apps/ocp-mcp-server typecheck
timeout 3 bun run --cwd apps/ocp-mcp-server start
```

Expected:

- selection tests PASS
- typecheck PASS
- stdio process starts without immediate crash

- [ ] **Step 6: Commit**

```bash
git add apps/ocp-mcp-server/src/ocp/selection.ts apps/ocp-mcp-server/src/tools/find-and-query-catalog.ts apps/ocp-mcp-server/src/selection.test.ts apps/ocp-mcp-server/src/server.ts
git commit -m "feat: add MCP catalog selection and high-level query flow"
```

---

### Task 6: Add smoke validation and operator documentation

**Files:**
- Create: `scripts/validate-mcp-gateway.ts`
- Create: `apps/ocp-mcp-server/README.md`
- Modify: `package.json`

- [ ] **Step 1: Write the smoke validator first**

```ts
// scripts/validate-mcp-gateway.ts
const registrationBaseUrl = process.env.OCP_MCP_DEFAULT_REGISTRATION_URL ?? 'http://localhost:4100';

async function main() {
  const search = await fetch(`${registrationBaseUrl}/ocp/catalogs/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'commerce', limit: 5, explain: false }),
  }).then((response) => response.json());

  const first = search.items?.[0];
  if (!first?.route_hint?.manifest_url) throw new Error('No route hint returned from registration search');

  const manifest = await fetch(first.route_hint.manifest_url).then((response) => response.json());
  const queryResult = await fetch(first.route_hint.query_url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ocp_version: '1.0',
      kind: 'CatalogQueryRequest',
      catalog_id: manifest.catalog_id,
      query_pack: 'ocp.query.keyword.v1',
      query: 'demo',
      filters: {},
      limit: 5,
      offset: 0,
      explain: false,
    }),
  }).then((response) => response.json());

  const entry = queryResult.entries?.[0];
  if (!entry?.entry_id) throw new Error('No query results returned from selected catalog');

  const resolved = await fetch(first.route_hint.resolve_url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ocp_version: '1.0',
      kind: 'CatalogResolveRequest',
      entry_id: entry.entry_id,
    }),
  }).then((response) => response.json());

  console.log(JSON.stringify({
    ok: true,
    catalog_id: manifest.catalog_id,
    entry_id: entry.entry_id,
    action_count: resolved.actions?.length ?? 0,
  }, null, 2));
}

await main();
```

- [ ] **Step 2: Document local usage and MCP client wiring**

```md
<!-- apps/ocp-mcp-server/README.md -->
# OCP MCP Server

This app exposes agent-facing MCP tools for OCP Catalog discovery, inspection, query, and resolve.

## Run

```bash
bun install
bun run registration:api
bun run commerce:catalog:api
bun run mcp:gateway
```

## Tools

- `search_catalogs`
- `inspect_catalog`
- `query_catalog`
- `resolve_catalog_entry`
- `find_and_query_catalog`

## Validation

```bash
bun run validate:mcp
```
```

- [ ] **Step 3: Run the full verification set**

Run:

```bash
bun test apps/ocp-mcp-server
bun run --cwd apps/ocp-mcp-server typecheck
bun run validate:mcp
```

Expected:

- all MCP gateway tests PASS
- typecheck PASS
- smoke validator prints `{ "ok": true, ... }`

- [ ] **Step 4: Commit**

```bash
git add scripts/validate-mcp-gateway.ts apps/ocp-mcp-server/README.md package.json
git commit -m "docs: add OCP MCP gateway validation and usage guide"
```

---

## Self-Review

### Spec coverage

- New standalone MCP app: covered by Tasks 1 through 6
- Shared config additions: covered by Task 1
- OCP HTTP client layer: covered by Task 2
- `search_catalogs`: covered by Task 3
- `inspect_catalog`: covered by Task 3
- `query_catalog`: covered by Task 4
- `resolve_catalog_entry`: covered by Task 4
- `find_and_query_catalog`: covered by Task 5
- deterministic catalog selection: covered by Task 5
- stdio transport: covered by Task 5
- smoke validation and local docs: covered by Task 6

### Placeholder scan

- No `TODO`, `TBD`, or “similar to above” shortcuts remain
- Each code-writing step includes concrete file paths and code
- Each verification step includes an exact command and expected outcome

### Type consistency

- config field names use the `OCP_MCP_*` prefix throughout
- tool names match the design doc exactly
- helper names are consistent across route-hint, manifest, query, and selection tasks
