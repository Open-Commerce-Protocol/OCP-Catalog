import * as z from 'zod/v4';

export const routeHintInput = z.record(z.string(), z.unknown());

export const searchCatalogsInput = {
  registration_base_url: z.string().url().optional(),
  query: z.string().describe('Catalog search phrase or intent summary. Omit or send an empty string to list active catalogs.').optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  explain: z.boolean().optional(),
};

export const inspectCatalogInput = {
  registration_base_url: z.string().url().optional(),
  catalog_id: z.string().min(1).optional(),
  route_hint: routeHintInput.optional(),
};

export const queryCatalogInput = {
  registration_base_url: z.string().url().optional(),
  catalog_id: z.string().min(1).optional(),
  route_hint: routeHintInput.optional(),
  query: z.string().min(1).optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  query_pack: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  offset: z.number().int().min(0).optional(),
  explain: z.boolean().optional(),
};

export const resolveCatalogEntryInput = {
  registration_base_url: z.string().url().optional(),
  catalog_id: z.string().min(1).optional(),
  route_hint: routeHintInput.optional(),
  entry_id: z.string().min(1),
};

export const findAndQueryCatalogInput = {
  registration_base_url: z.string().url().optional(),
  catalog_query: z.string().min(1).describe('Search phrase used to find a suitable catalog.'),
  catalog_filters: z.record(z.string(), z.unknown()).optional(),
  query: z.string().min(1).optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  query_pack: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  offset: z.number().int().min(0).optional(),
};

export const searchCatalogsInputSchema = z.object(searchCatalogsInput);
export const inspectCatalogInputSchema = z.object(inspectCatalogInput);
export const queryCatalogInputSchema = z.object(queryCatalogInput);
export const resolveCatalogEntryInputSchema = z.object(resolveCatalogEntryInput);
export const findAndQueryCatalogInputSchema = z.object(findAndQueryCatalogInput);

export type SearchCatalogsInput = z.infer<typeof searchCatalogsInputSchema>;
export type InspectCatalogInput = z.infer<typeof inspectCatalogInputSchema>;
export type QueryCatalogInput = z.infer<typeof queryCatalogInputSchema>;
export type ResolveCatalogEntryInput = z.infer<typeof resolveCatalogEntryInputSchema>;
export type FindAndQueryCatalogInput = z.infer<typeof findAndQueryCatalogInputSchema>;
