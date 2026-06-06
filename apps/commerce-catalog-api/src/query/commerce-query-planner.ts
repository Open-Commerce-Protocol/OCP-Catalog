import { planCatalogQuery } from '@ocp-catalog/catalog-core';
import type { CatalogScenarioModule } from '@ocp-catalog/catalog-core';
import type { CatalogQueryRequest } from '@ocp-catalog/ocp-schema';

export function planCommerceQuery(
  scenario: CatalogScenarioModule,
  request: CatalogQueryRequest,
  options: { retrievalAvailable: boolean },
) {
  return planCatalogQuery(scenario.queryCapabilities(), request, options);
}
