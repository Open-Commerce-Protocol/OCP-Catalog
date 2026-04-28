const registrationBaseUrl = trimTrailingSlash(process.env.OCP_MCP_DEFAULT_REGISTRATION_URL ?? 'http://localhost:4100');
const userAgent = process.env.OCP_MCP_USER_AGENT ?? 'ocp-mcp-server/0.1.0';
const apiKey = process.env.OCP_MCP_API_KEY ?? '';

async function main() {
  const search = await postJson(`${registrationBaseUrl}/ocp/catalogs/search`, {
    ocp_version: '1.0',
    kind: 'CatalogSearchRequest',
    query: 'commerce',
    filters: {
      supports_resolve: true,
    },
    limit: 5,
    explain: false,
  });

  const first = firstCatalog(search);
  const routeHint = first.route_hint as Record<string, unknown>;
  assertString(routeHint.manifest_url, 'Registration search did not return route_hint.manifest_url');
  assertString(routeHint.query_url, 'Registration search did not return route_hint.query_url');
  assertString(routeHint.resolve_url, 'Registration search did not return route_hint.resolve_url');

  const manifest = await getJson(routeHint.manifest_url);
  const catalogId = assertString(manifest.catalog_id, 'Catalog manifest did not return catalog_id');
  const queryPack = firstSupportedQueryPack(manifest);
  const queryResult = await postJson(routeHint.query_url, {
    ocp_version: '1.0',
    kind: 'CatalogQueryRequest',
    catalog_id: catalogId,
    query_pack: queryPack,
    query: queryPack ? 'demo' : undefined,
    filters: {},
    limit: 5,
    offset: 0,
    explain: false,
  }, apiKey || undefined);

  const entry = firstEntry(queryResult);
  const entryId = assertString(entry.entry_id, 'Catalog query did not return entry_id');
  const resolved = await postJson(routeHint.resolve_url, {
    ocp_version: '1.0',
    kind: 'ResolveRequest',
    catalog_id: catalogId,
    entry_id: entryId,
  });

  console.log(JSON.stringify({
    ok: true,
    registration_base_url: registrationBaseUrl,
    catalog_id: catalogId,
    entry_id: entryId,
    action_count: Array.isArray(resolved.action_bindings) ? resolved.action_bindings.length : 0,
  }, null, 2));
}

async function getJson(url: unknown) {
  const response = await fetch(assertString(url, 'Expected URL string'), {
    headers: {
      'user-agent': userAgent,
    },
  });
  return parseResponse(response);
}

async function postJson(url: unknown, body: Record<string, unknown>, apiKey?: string) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': userAgent,
  };
  if (apiKey) headers['x-api-key'] = apiKey;

  const response = await fetch(assertString(url, 'Expected URL string'), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return parseResponse(response);
}

async function parseResponse(response: Response) {
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${response.url}: ${JSON.stringify(payload)}`);
  }
  return payload as Record<string, unknown>;
}

function firstCatalog(search: Record<string, unknown>) {
  const items = search.items;
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Registration search returned no catalogs. Register a catalog before running validate:mcp.');
  }
  const first = items[0];
  if (!first || typeof first !== 'object' || Array.isArray(first)) {
    throw new Error('Registration search returned an invalid catalog item.');
  }
  return first as Record<string, unknown>;
}

function firstEntry(queryResult: Record<string, unknown>) {
  const items = queryResult.items;
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Catalog query returned no entries. Seed and publish provider data before running validate:mcp.');
  }
  const first = items[0];
  if (!first || typeof first !== 'object' || Array.isArray(first)) {
    throw new Error('Catalog query returned an invalid entry.');
  }
  return first as Record<string, unknown>;
}

function firstSupportedQueryPack(manifest: Record<string, unknown>) {
  const capabilities = manifest.query_capabilities;
  if (!Array.isArray(capabilities)) return undefined;

  for (const capability of capabilities) {
    if (!capability || typeof capability !== 'object' || Array.isArray(capability)) continue;
    const queryPacks = (capability as Record<string, unknown>).query_packs;
    if (!Array.isArray(queryPacks)) continue;
    const first = queryPacks[0];
    if (!first || typeof first !== 'object' || Array.isArray(first)) continue;
    const packId = (first as Record<string, unknown>).pack_id;
    if (typeof packId === 'string') return packId;
  }

  return undefined;
}

function assertString(value: unknown, message: string) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(message);
  return value;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

await main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    message: error instanceof Error ? error.message : 'Unknown validate:mcp failure',
    hint: 'Start bun run registration:api and bun run commerce:catalog:api, then register/seed catalog data before retrying.',
  }, null, 2));
  process.exit(1);
});
