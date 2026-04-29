export const OCP_CATALOG_GUIDE_URI = 'ocp://catalog/guide';

export const OCP_CATALOG_INSTRUCTIONS = [
  'This MCP server is an OCP Catalog gateway. OCP Catalog is a protocol for discovering catalogs, querying catalog entries, and resolving selected entries into actionable references.',
  'Use search_catalogs first to discover available OCP catalogs from a Registration node. If the user asks what services exist, call search_catalogs with no query or a broad intent.',
  'Use inspect_catalog before querying when you need to know a catalog domain, supported query packs, supported languages, filter fields, or endpoint health.',
  'Use query_catalog to retrieve candidate entries from one selected catalog. Use only query packs and filters shown by inspect_catalog or the route hint.',
  'Use resolve_catalog_entry after the user selects an entry or needs actionable details such as source URLs, contact links, purchase links, or provider-owned actions.',
  'Use find_and_query_catalog when the user has a domain intent and you want the gateway to search catalogs, choose the best candidate, and query it in one step.',
].join('\n');

export function describeOcpCatalog() {
  return {
    service: {
      name: 'OCP Catalog MCP Gateway',
      purpose: 'Let agents discover OCP catalogs, query catalog content, and resolve selected entries into provider-owned actions.',
      protocol_version: 'OCP Catalog 1.0',
    },
    concepts: [
      {
        name: 'Registration node',
        description: 'A registry that indexes active OCP Catalog nodes and returns route hints for matching catalogs.',
      },
      {
        name: 'Catalog',
        description: 'A domain-specific searchable service, such as product search or channel opportunity discovery.',
      },
      {
        name: 'Route hint',
        description: 'Connection metadata for a catalog, including manifest, query, resolve URLs, auth requirements, supported query packs, and health.',
      },
      {
        name: 'Manifest',
        description: 'A catalog self-description document that declares capabilities, query packs, filterable fields, object contracts, and endpoints.',
      },
      {
        name: 'Catalog entry',
        description: 'A search result candidate returned by a catalog query. It is intentionally lightweight and can be resolved later.',
      },
      {
        name: 'Resolve',
        description: 'The step that turns a selected entry into visible attributes and action bindings owned by the provider.',
      },
    ],
    typical_workflows: [
      {
        user_intent: 'What services/catalogs are available?',
        steps: ['search_catalogs with no query', 'summarize each catalog by catalog_name, description, supported_query_packs, languages, and health_status'],
      },
      {
        user_intent: 'Find something across OCP, for example shoes or channel opportunities',
        steps: ['search_catalogs or find_and_query_catalog with the user intent', 'inspect_catalog if query constraints are unclear', 'query_catalog with supported query_pack and filters'],
      },
      {
        user_intent: 'Tell me more about this result or help me act on it',
        steps: ['resolve_catalog_entry with the selected entry_id', 'summarize visible_attributes and action_bindings'],
      },
    ],
    tool_selection: {
      search_catalogs: 'Discover catalogs. Empty query lists active catalogs; broad queries may fallback to listing.',
      inspect_catalog: 'Read a catalog manifest and capability summary before choosing query packs or filters.',
      query_catalog: 'Query one known catalog and return entries plus pagination.',
      resolve_catalog_entry: 'Resolve one entry into provider-owned details and action bindings.',
      find_and_query_catalog: 'Convenience tool that searches for the best catalog and queries it.',
    },
    response_guidance: [
      'Do not invent catalog capabilities. Use manifest and route hint data.',
      'Mention catalog health and verification when it affects trust.',
      'If keyword search returns no catalog, retry or rely on search_catalogs listing behavior before saying none exist.',
      'For user-facing answers, translate technical fields into domain language, but keep IDs available when follow-up actions need them.',
    ],
  };
}

export function getOcpCatalogGuideMarkdown() {
  const description = describeOcpCatalog();

  return `# OCP Catalog MCP Gateway

${description.service.purpose}

## Core Concepts

- Registration node: indexes active OCP Catalog nodes and returns route hints.
- Catalog: a domain-specific searchable service, such as product search or channel opportunity discovery.
- Route hint: connection metadata for a catalog, including manifest, query, resolve URLs, supported query packs, auth requirements, and health.
- Manifest: the catalog self-description document. It declares capabilities, query packs, filterable fields, object contracts, and endpoints.
- Catalog entry: a lightweight candidate returned by a query.
- Resolve: turns a selected entry into visible attributes and provider-owned actions.

## Recommended Workflow

1. Use \`search_catalogs\` to discover catalogs. Omit \`query\` to list active catalogs.
2. Use \`inspect_catalog\` when you need capabilities, languages, filter fields, or endpoint details.
3. Use \`query_catalog\` to retrieve entries from one selected catalog.
4. Use \`resolve_catalog_entry\` when the user selects an entry or needs actionable details.
5. Use \`find_and_query_catalog\` for a one-shot search-and-query flow.

## Agent Rules

- Do not invent capabilities; rely on route hints and manifests.
- Only send query packs and filters supported by the selected catalog.
- Treat query results as candidates. Resolve entries before presenting provider-owned actions.
- If a broad service-discovery query returns no matches, list active catalogs before concluding none exist.
`;
}
