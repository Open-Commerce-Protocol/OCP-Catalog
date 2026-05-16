import type { CatalogScenarioModule } from '@ocp-catalog/catalog-core';
import type { CatalogQueryRequest } from '@ocp-catalog/ocp-schema';
import { AppError } from '@ocp-catalog/shared';
import { inferCommerceQueryMode } from './query-mode';

type QueryMode = 'keyword' | 'filter' | 'semantic' | 'hybrid';

export type CommerceQueryPlan = {
  queryMode: QueryMode;
  selectedCapabilityId?: string;
  selectedQueryPack?: string;
  supportsExplain: boolean;
  policySummary: {
    selected_capability_id?: string;
    selected_query_pack?: string;
    query_mode: QueryMode;
    supports_explain: boolean;
    accepted_filters: string[];
    rejected_filters: string[];
    warnings: string[];
  };
};

export function planCommerceQuery(
  scenario: CatalogScenarioModule,
  request: CatalogQueryRequest,
  options: { retrievalAvailable: boolean },
): CommerceQueryPlan {
  const descriptors = queryPackDescriptorsForScenario(scenario);
  const supportedPacks = descriptors.map((descriptor) => descriptor.pack_id);
  const requestedPack = request.query_pack;
  const requestedDescriptor = requestedPack
    ? descriptors.find((descriptor) => descriptor.pack_id === requestedPack)
    : undefined;

  if (requestedPack && !requestedDescriptor) {
    throw new AppError('validation_error', `Unsupported query_pack: ${requestedPack}`, 400, {
      supported_query_packs: supportedPacks,
    });
  }

  if (requestedPack && requestedDescriptor && requestedDescriptor.query_modes.length === 0) {
    throw new AppError('validation_error', `query_pack ${requestedPack} does not declare query_modes`, 400, {
      query_pack: requestedPack,
      supported_query_packs: supportedPacks,
    });
  }

  const queryMode = requestedDescriptor
    ? inferQueryModeForPack(requestedDescriptor.query_modes, request.query, request.filters)
    : inferQueryModeForUnpackedRequest(descriptors, request.query, request.filters);
  const selectedDescriptor = requestedDescriptor
    ?? descriptors.find((descriptor) => descriptor.query_modes.includes(queryMode));

  if (!selectedDescriptor) {
    const supportedModes = unique(descriptors.flatMap((descriptor) => descriptor.query_modes));
    throw new AppError('validation_error', `Unsupported query strategy: ${queryMode}`, 400, {
      supported_query_modes: supportedModes,
    });
  }

  if (!selectedDescriptor.query_modes.includes(queryMode)) {
    throw new AppError('validation_error', `query_pack ${selectedDescriptor.pack_id} does not support query strategy ${queryMode}`, 400, {
      query_pack: selectedDescriptor.pack_id,
      supported_query_modes: selectedDescriptor.query_modes,
    });
  }

  if (queryMode === 'semantic' && !request.query.trim()) {
    throw new AppError('validation_error', 'semantic query requires a non-empty query', 400, {
      query_pack: selectedDescriptor.pack_id,
      query_mode: queryMode,
    });
  }

  if (queryMode === 'semantic' && !options.retrievalAvailable) {
    throw new AppError('validation_error', 'semantic query capability is not enabled for this Catalog yet', 400, {
      query_pack: selectedDescriptor.pack_id,
      query_mode: queryMode,
    });
  }

  const acceptedFilters = Object.entries(request.filters)
    .filter(([, value]) => value !== undefined && value !== false)
    .map(([field]) => field)
    .sort();

  return {
    queryMode,
    selectedCapabilityId: selectedDescriptor.capability_id,
    selectedQueryPack: selectedDescriptor.pack_id,
    supportsExplain: selectedDescriptor.supports_explain,
    policySummary: {
      selected_capability_id: selectedDescriptor.capability_id,
      selected_query_pack: selectedDescriptor.pack_id,
      query_mode: queryMode,
      supports_explain: selectedDescriptor.supports_explain,
      accepted_filters: acceptedFilters,
      rejected_filters: [],
      warnings: [],
    },
  };
}

function inferQueryModeForUnpackedRequest(
  descriptors: QueryPackDescriptor[],
  query: string,
  filters: CatalogQueryRequest['filters'],
) {
  const inferred = inferCommerceQueryMode(query, filters);
  if (descriptors.some((descriptor) => descriptor.query_modes.includes(inferred))) return inferred;

  const fallbackOrder: QueryMode[] = inferred === 'hybrid'
    ? ['keyword', 'filter', 'semantic']
    : ['filter', 'keyword', 'hybrid', 'semantic'];
  const fallback = fallbackOrder.find((mode) => descriptors.some((descriptor) => descriptor.query_modes.includes(mode)));
  if (fallback) return fallback;
  return inferred;
}

function inferQueryModeForPack(
  packModes: QueryMode[],
  query: string,
  filters: CatalogQueryRequest['filters'],
) {
  const hasQuery = query.trim().length > 0;
  const hasFilters = Object.values(filters).some(Boolean);

  if (packModes.includes('semantic')) return 'semantic';
  if (hasQuery && hasFilters && packModes.includes('hybrid')) return 'hybrid';
  if (!hasQuery && packModes.includes('filter')) return 'filter';
  if (hasQuery && packModes.includes('keyword')) return 'keyword';
  if (packModes.includes('hybrid')) return 'hybrid';
  if (packModes.includes('filter')) return 'filter';
  if (packModes.includes('keyword')) return 'keyword';
  return packModes[0] ?? 'keyword';
}

type QueryPackDescriptor = {
  capability_id?: string;
  pack_id: string;
  query_modes: QueryMode[];
  supports_explain: boolean;
};

function queryPackDescriptorsForScenario(scenario: CatalogScenarioModule): QueryPackDescriptor[] {
  return scenario.queryCapabilities().flatMap((capability) => {
    const capabilityId = stringValue(capability.capability_id);
    const supportsExplain = capability.supports_explain !== false;
    return queryPackDescriptors(capability).map((descriptor) => ({
      ...descriptor,
      capability_id: capabilityId,
      supports_explain: supportsExplain,
    }));
  });
}

function queryPackDescriptors(capability: Record<string, unknown>) {
  const queryPacks = capability.query_packs;
  if (!Array.isArray(queryPacks)) return [];

  return queryPacks
    .map((queryPack) => {
      if (typeof queryPack === 'string') {
        return { pack_id: queryPack, query_modes: [] as QueryMode[] };
      }

      if (typeof queryPack !== 'object' || queryPack === null) return null;
      const record = queryPack as Record<string, unknown>;
      const packId = stringValue(record.pack_id);
      if (!packId) return null;

      return {
        pack_id: packId,
        query_modes: queryModeArray(record.query_modes),
      };
    })
    .filter((queryPack): queryPack is { pack_id: string; query_modes: QueryMode[] } => Boolean(queryPack));
}

function queryModeArray(value: unknown): QueryMode[] {
  const allowed = new Set<QueryMode>(['keyword', 'filter', 'semantic', 'hybrid']);
  return Array.isArray(value) ? value.filter((item): item is QueryMode => allowed.has(item as QueryMode)) : [];
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}
