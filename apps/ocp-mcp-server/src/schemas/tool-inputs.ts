import * as z from 'zod/v4';

export const routeHintInput = z
  .record(z.string(), z.unknown())
  .describe('Route hint object returned by search_catalogs or find_and_query_catalog. Prefer passing this when available instead of only catalog_id.');

export const searchCatalogsInput = {
  registration_base_url: z.string().url().describe('Optional Registration node base URL. Omit to use the MCP server default registration node.').optional(),
  query: z.string().describe('Catalog search phrase or user intent summary. Omit or send an empty string to list active catalogs.').optional(),
  filters: z.record(z.string(), z.unknown()).describe('Registration-node catalog discovery filters only. Do not use this to filter products inside a catalog.').optional(),
  limit: z.number().int().min(1).max(50).describe('Maximum number of catalogs to return. Omit for the server default.').optional(),
  explain: z.boolean().describe('When true, include selection and fallback reasoning for the catalog discovery step.').optional(),
};

export const inspectCatalogInput = {
  registration_base_url: z.string().url().describe('Optional Registration node base URL. Omit to use the MCP server default registration node.').optional(),
  catalog_id: z.string().min(1).describe('Catalog id returned by search_catalogs. Prefer route_hint when the previous tool returned one.').optional(),
  route_hint: routeHintInput.optional(),
};

export const queryCatalogInput = {
  registration_base_url: z.string().url().describe('Optional Registration node base URL. Omit to use the MCP server default registration node.').optional(),
  catalog_id: z.string().min(1).describe('Catalog id returned by search_catalogs. Prefer route_hint when the previous tool returned one.').optional(),
  route_hint: routeHintInput.optional(),
  query: z.string().min(1).describe('Natural language or keyword query for entries inside the selected catalog, such as a product, service, supplier, opportunity, SKU, or category.').optional(),
  filters: z.record(z.string(), z.unknown()).describe('Structured filters supported by the selected catalog only, such as category or in_stock_only when advertised. Do not invent fields. Inspect the catalog first when uncertain.').optional(),
  query_pack: z.string().min(1).describe('Exact query pack id declared by inspect_catalog or the route hint. Omit when uncertain.').optional(),
  query_mode: z.enum(['keyword', 'filter', 'semantic', 'hybrid']).describe('Exact query mode supported by the selected query_pack. Use semantic only when the catalog declares semantic support.').optional(),
  limit: z.number().int().min(1).max(50).describe('Maximum number of catalog entries to return. Omit for the catalog default.').optional(),
  offset: z.literal(0).describe('Only the first page is supported. Cursor pagination will replace offset pagination.').optional(),
  explain: z.boolean().describe('When true, include query planning, validation, and capability details.').optional(),
};

export const resolveCatalogEntryInput = {
  registration_base_url: z.string().url().describe('Optional Registration node base URL. Omit to use the MCP server default registration node.').optional(),
  catalog_id: z.string().min(1).describe('Catalog id returned by search_catalogs or find_and_query_catalog. Prefer route_hint when available.').optional(),
  route_hint: routeHintInput.optional(),
  entry_id: z.string().min(1).describe('Catalog entry id returned by query_catalog or find_and_query_catalog.query_result.entries.'),
  purpose: z.enum(['view', 'checkout', 'contact', 'workflow']).describe('Why the entry is being resolved. Defaults to view.').optional(),
  live_check: z.boolean().describe('When true, ask the catalog to include live checks such as current availability. Defaults to true.').optional(),
  requested_fields: z.array(z.string().min(1)).describe('Optional resolved fields the caller wants when supported by the catalog. Omit unless the catalog documents field names.').optional(),
};

export const findAndQueryCatalogInput = {
  registration_base_url: z.string().url().describe('Optional Registration node base URL. Omit to use the MCP server default registration node.').optional(),
  catalog_query: z.string().min(1).describe('Search phrase or intent used to find a suitable catalog, such as commerce product catalog, supplier directory, service marketplace, or channel opportunities.'),
  catalog_filters: z.record(z.string(), z.unknown()).describe('Registration-node catalog discovery filters only. Do not use this to filter products inside the selected catalog.').optional(),
  query: z.string().min(1).describe('Natural language or keyword query to run inside the selected catalog, such as wireless headphones, CRM partner program, supplier name, SKU, or product category.').optional(),
  filters: z.record(z.string(), z.unknown()).describe('Structured filters supported by the selected catalog only, such as category or in_stock_only when advertised. Do not invent fields. Omit when unsupported or uncertain.').optional(),
  query_pack: z.string().min(1).describe('Exact query pack id declared by the selected catalog. Omit when uncertain.').optional(),
  limit: z.number().int().min(1).max(50).describe('Maximum number of catalog entries to return. Omit for the catalog default.').optional(),
  offset: z.literal(0).describe('Only the first page is supported. Cursor pagination will replace offset pagination.').optional(),
};

export const skillSearchInput = {
  query: z.string().min(1).describe('Natural language product query, such as "wireless headphones under 200 yuan" or "5kg dog food".'),
  page: z.number().int().min(1).describe('1-based page number across the fan-out result. Omit for the first page.').optional(),
  page_size: z.number().int().min(1).max(50).describe('Items per catalog per request, default 10.').optional(),
};

export const skillDeeplinkInput = {
  catalog_id: z.string().min(1).describe('Catalog id returned by skill_search items[].catalog_id.'),
  entry_ref: z.string().min(1).describe('Opaque entry token returned by skill_search items[].entry_ref. Pass it back verbatim.'),
  sub_id: z.string().min(1).describe('Optional sub id for attribution; defaults to the calling agent\'s api key id when omitted.').optional(),
};

export const searchCatalogsInputSchema = z.object(searchCatalogsInput);
export const inspectCatalogInputSchema = z.object(inspectCatalogInput);
export const queryCatalogInputSchema = z.object(queryCatalogInput);
export const resolveCatalogEntryInputSchema = z.object(resolveCatalogEntryInput);
export const findAndQueryCatalogInputSchema = z.object(findAndQueryCatalogInput);
export const skillSearchInputSchema = z.object(skillSearchInput);
export const skillDeeplinkInputSchema = z.object(skillDeeplinkInput);

export type SearchCatalogsInput = z.infer<typeof searchCatalogsInputSchema>;
export type InspectCatalogInput = z.infer<typeof inspectCatalogInputSchema>;
export type QueryCatalogInput = z.infer<typeof queryCatalogInputSchema>;
export type ResolveCatalogEntryInput = z.infer<typeof resolveCatalogEntryInputSchema>;
export type FindAndQueryCatalogInput = z.infer<typeof findAndQueryCatalogInputSchema>;
export type SkillSearchInput = z.infer<typeof skillSearchInputSchema>;
export type SkillDeeplinkInput = z.infer<typeof skillDeeplinkInputSchema>;
