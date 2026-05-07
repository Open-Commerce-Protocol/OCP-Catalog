import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import {
  findAndQueryCatalogInput,
  inspectCatalogInput,
  queryCatalogInput,
  resolveCatalogEntryInput,
  searchCatalogsInput,
} from '../schemas/tool-inputs';

export type OcpToolId =
  | 'describe_ocp_catalog'
  | 'search_catalogs'
  | 'inspect_catalog'
  | 'query_catalog'
  | 'resolve_catalog_entry'
  | 'find_and_query_catalog';

export type OcpToolDefinition = {
  id: OcpToolId;
  title: string;
  description: string;
  inputSchema?: ZodRawShapeCompat;
  annotations: ToolAnnotations;
  selectionGuide: string;
  userIntents: string[];
};

const readOnlyClosedWorld: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };
const readOnlyOpenWorld: ToolAnnotations = { readOnlyHint: true, openWorldHint: true };

export const OCP_TOOL_DEFINITIONS: readonly OcpToolDefinition[] = [
  {
    id: 'describe_ocp_catalog',
    title: 'Describe OCP Catalog',
    description: 'Explain what this MCP server does, the OCP Catalog concepts, and the recommended agent workflow. Call this first only if you are unfamiliar with OCP Catalog.',
    annotations: readOnlyClosedWorld,
    selectionGuide: 'Explain OCP Catalog concepts and workflows. Do not use this for user-facing search when the user already asked for products, prices, stock, services, opportunities, suppliers, or catalog data.',
    userIntents: [
      'Explain what OCP Catalog is',
      'Describe how this MCP gateway works',
      'Show the recommended OCP tool workflow',
    ],
  },
  {
    id: 'search_catalogs',
    title: 'Discover searchable OCP catalogs',
    description: 'Discover available OCP-powered catalogs, searchable business domains, services, providers, or data sources from a Registration node. Use this to answer what this connector can search. Do not use this to search products directly; use it to find which catalog should be queried.',
    inputSchema: searchCatalogsInput,
    annotations: readOnlyOpenWorld,
    selectionGuide: 'Use for catalog/service discovery. Empty query lists active catalogs; broad queries find matching searchable domains before a catalog query.',
    userIntents: [
      'What catalogs are available?',
      'What services or domains can this OCP connector search?',
      'Find the right catalog for a broad domain',
    ],
  },
  {
    id: 'inspect_catalog',
    title: 'Inspect an OCP catalog',
    description: 'Fetch route hint and manifest details for a selected OCP catalog. Use after discovery when you need supported query packs, filters, languages, object contracts, endpoint health, auth requirements, or catalog capabilities before querying.',
    inputSchema: inspectCatalogInput,
    annotations: readOnlyOpenWorld,
    selectionGuide: 'Use before query_catalog when constraints are unclear or when you need exact supported query packs, filter fields, languages, contracts, or health.',
    userIntents: [
      'What filters can I use?',
      'What query packs or languages does this catalog support?',
      'Inspect catalog capabilities and endpoint health',
    ],
  },
  {
    id: 'query_catalog',
    title: 'Query a selected OCP catalog',
    description: 'Query one known OCP catalog for product or catalog-item retrieval, including prices, inventory, availability, supplier/provider, category, brand, SKU, service, opportunity, and purchasable result candidates. Typical workflow: search_catalogs -> inspect_catalog when needed -> query_catalog -> resolve_catalog_entry for selected results.',
    inputSchema: queryCatalogInput,
    annotations: readOnlyOpenWorld,
    selectionGuide: 'Use when a catalog is already selected and the user wants entries from that catalog. Use only supported query packs and filters shown by inspect_catalog or route hints.',
    userIntents: [
      'Search inside this selected catalog',
      'Find products, prices, stock, suppliers, services, or opportunities in a known catalog',
      'Retrieve candidate catalog entries before resolving details',
    ],
  },
  {
    id: 'resolve_catalog_entry',
    title: 'Resolve an OCP catalog entry',
    description: 'Resolve a selected OCP catalog entry into final visible attributes and provider-owned action bindings. Use when the user asks for final product details, supplier/provider-owned fields, purchase/view/contact links, source URL, or how to act on a selected result.',
    inputSchema: resolveCatalogEntryInput,
    annotations: readOnlyOpenWorld,
    selectionGuide: 'Use after query_catalog or find_and_query_catalog when the user selects an entry or needs purchase, view, contact, source, or provider-owned action details.',
    userIntents: [
      'Show details for this selected result',
      'Get purchase, view, contact, or source links',
      'Find provider-owned actions for an entry',
    ],
  },
  {
    id: 'find_and_query_catalog',
    title: 'Find and query OCP catalogs',
    description: 'Use this first when the user asks to find, search, list, compare, or retrieve products, catalog items, prices, stock, inventory, availability, suppliers, providers, stores, services, opportunities, or purchasable options across OCP and does not specify a catalog. This one-shot helper searches catalogs, chooses the best candidate, and runs a catalog query.',
    inputSchema: findAndQueryCatalogInput,
    annotations: readOnlyOpenWorld,
    selectionGuide: 'Default natural-language retrieval entrypoint. Prefer find_and_query_catalog when the user asks for products, prices, stock, inventory, availability, suppliers, services, opportunities, or catalog data and no catalog is already selected.',
    userIntents: [
      'Find products, compare prices, check stock or inventory',
      'Search catalog items or purchasable options without choosing a catalog first',
      'Find suppliers, providers, services, channel opportunities, or domain records across OCP',
    ],
  },
] as const;

export function getOcpToolDefinition(id: OcpToolId) {
  const definition = OCP_TOOL_DEFINITIONS.find((tool) => tool.id === id);
  if (!definition) {
    throw new Error(`Unknown OCP tool definition: ${id}`);
  }
  return definition;
}
