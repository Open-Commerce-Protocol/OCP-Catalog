import { OCP_TOOL_DEFINITIONS, getOcpToolDefinition } from '../tools/definitions';

export const OCP_CATALOG_GUIDE_URI = 'ocp://catalog/guide';

export const OCP_CATALOG_INSTRUCTIONS = [
  'This MCP server is an OCP Catalog gateway. OCP Catalog is a protocol for discovering catalogs, querying catalog entries, and resolving selected entries into actionable references.',
  'When the user asks to search, find, list, compare, or retrieve products, catalog items, prices, stock, inventory, availability, suppliers, providers, services, opportunities, or purchasable options, prefer find_and_query_catalog unless a catalog is already selected.',
  'Use search_catalogs for catalog/service discovery, such as what searchable domains or OCP catalogs are available. Do not use search_catalogs to search products directly.',
  'Use inspect_catalog before querying when you need supported query packs, languages, filter fields, object contracts, endpoint health, or auth requirements.',
  'Use query_catalog to retrieve candidate entries from one selected catalog. Use only query packs and filters shown by inspect_catalog or the route hint.',
  'Use resolve_catalog_entry after the user selects an entry or needs actionable details such as source URLs, contact links, purchase links, purchase/view/contact actions, or provider-owned actions.',
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
        user_intent: 'Find wireless headphones under $100 in stock and compare prices',
        steps: ['find_and_query_catalog with catalog_query "commerce product catalog" and query "wireless headphones"', 'only include price or inventory filters when supported by the selected catalog', 'summarize candidates with IDs so selected entries can be resolved'],
      },
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
    tool_selection: Object.fromEntries(OCP_TOOL_DEFINITIONS.map((tool) => [tool.id, tool.selectionGuide])),
    user_intent_map: Object.fromEntries(OCP_TOOL_DEFINITIONS.map((tool) => [tool.id, tool.userIntents])),
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
  const primarySearchTool = getOcpToolDefinition('find_and_query_catalog');

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

1. Use \`find_and_query_catalog\` first for natural-language retrieval intents such as products, prices, inventory, availability, suppliers, services, opportunities, or catalog data when no catalog is already selected.
2. Use \`search_catalogs\` to discover catalogs. Omit \`query\` to list active catalogs.
3. Use \`inspect_catalog\` when you need capabilities, languages, filter fields, or endpoint details.
4. Use \`query_catalog\` to retrieve entries from one selected catalog.
5. Use \`resolve_catalog_entry\` when the user selects an entry or needs actionable details.

## User Intent to Tool

${OCP_TOOL_DEFINITIONS.map((tool) => `- ${tool.userIntents.join('; ')} -> \`${tool.id}\``).join('\n')}

Primary retrieval rule: ${primarySearchTool.selectionGuide}

## Agent Rules

- Do not invent capabilities; rely on route hints and manifests.
- Only send query packs and filters supported by the selected catalog.
- Treat query results as candidates. Resolve entries before presenting provider-owned actions.
- If a broad service-discovery query returns no matches, list active catalogs before concluding none exist.
`;
}
