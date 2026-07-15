import { selectBestCatalog } from '../ocp/selection';
import type { FindAndQueryCatalogInput } from '../schemas/tool-inputs';
import type { ToolDeps } from './context';
import { queryCatalogTool } from './query-catalog';
import { searchCatalogsTool } from './search-catalogs';

export async function findAndQueryCatalogTool(input: FindAndQueryCatalogInput, deps: ToolDeps) {
  const searchResult = await searchCatalogsTool({
    registration_base_url: input.registration_base_url,
    query: input.catalog_query,
    filters: input.catalog_filters,
    limit: input.limit ?? 10,
    explain: true,
  }, deps);
  const selectedCatalog = selectBestCatalog(searchResult.catalogs);
  // When the caller only supplies catalog_query (the phrase used to locate a
  // catalog) but no inner product query, reuse it so keyword catalogs are not
  // asked to run an empty query, which upstreams like Alimama reject.
  const innerQuery = input.query ?? input.catalog_query;
  const queryResult = await queryCatalogTool({
    route_hint: selectedCatalog.route_hint,
    query: innerQuery,
    filters: input.filters,
    query_pack: input.query_pack,
    query_mode: input.query_mode,
    limit: input.limit,
    offset: input.offset,
    explain: true,
  }, deps);

  return {
    registration_base_url: searchResult.registration_base_url,
    selected_catalog: selectedCatalog,
    query_result: queryResult,
    search_explain: searchResult.explain,
  };
}
