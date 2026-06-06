import type { CatalogQueryRequest } from '@ocp-catalog/ocp-schema';
import { AppError } from '@ocp-catalog/shared';

export type CatalogQueryMode = 'keyword' | 'filter' | 'semantic' | 'hybrid';

export type CatalogQueryPlan = {
  queryMode: CatalogQueryMode;
  selectedCapabilityId?: string;
  selectedQueryPack?: string;
  supportsExplain: boolean;
  policySummary: {
    selected_capability_id?: string;
    selected_query_pack?: string;
    query_mode: CatalogQueryMode;
    supports_explain: boolean;
    accepted_filters: string[];
    rejected_filters: string[];
    warnings: string[];
  };
};

export function planCatalogQuery(
  queryCapabilities: QueryCapabilityLike[],
  request: CatalogQueryRequest,
  options: { retrievalAvailable: boolean },
): CatalogQueryPlan {
  const descriptors = queryPackDescriptorsForCapabilities(queryCapabilities);
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

  const requestedQueryMode = requestedQueryModeFromRequest(request);
  const queryMode = requestedQueryMode ?? inferQueryMode(request.query, request.filters);
  const selectedDescriptor = requestedDescriptor
    ?? descriptors.find((descriptor) => descriptor.query_modes.includes(queryMode));

  if (!selectedDescriptor) {
    const supportedModes = unique(descriptors.flatMap((descriptor) => descriptor.query_modes));
    throw new AppError('validation_error', `Unsupported query strategy: ${queryMode}`, 400, {
      supported_query_modes: supportedModes,
    });
  }

  if (!selectedDescriptor.query_modes.includes(queryMode)) {
    throw new AppError('validation_error', `query_pack ${selectedDescriptor.pack_id} does not support query mode ${queryMode}`, 400, {
      query_pack: selectedDescriptor.pack_id,
      query_mode: queryMode,
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

function inferQueryMode(query: string, filters: CatalogQueryRequest['filters']): CatalogQueryMode {
  const hasQuery = query.trim().length > 0;
  const hasFilters = Object.values(filters).some(Boolean);
  if (hasQuery && hasFilters) return 'hybrid';
  if (hasQuery) return 'keyword';
  return 'filter';
}

function requestedQueryModeFromRequest(request: CatalogQueryRequest): CatalogQueryMode | undefined {
  const value = (request as CatalogQueryRequest & { query_mode?: unknown }).query_mode;
  if (value === undefined) return undefined;
  if (isCatalogQueryMode(value)) return value;
  throw new AppError('validation_error', `Unsupported query mode: ${String(value)}`, 400, {
    query_mode: value,
    supported_query_modes: CATALOG_QUERY_MODES,
  });
}

function isCatalogQueryMode(value: unknown): value is CatalogQueryMode {
  return typeof value === 'string' && CATALOG_QUERY_MODES.includes(value as CatalogQueryMode);
}

const CATALOG_QUERY_MODES: CatalogQueryMode[] = ['keyword', 'filter', 'semantic', 'hybrid'];

type QueryPackDescriptor = {
  capability_id?: string;
  pack_id: string;
  query_modes: CatalogQueryMode[];
  supports_explain: boolean;
};

type QueryCapabilityLike = {
  capability_id: string;
  query_packs: ReadonlyArray<{
    pack_id: string;
    query_modes: ReadonlyArray<CatalogQueryMode>;
  }>;
  supports_explain?: boolean;
};

function queryPackDescriptorsForCapabilities(queryCapabilities: QueryCapabilityLike[]): QueryPackDescriptor[] {
  return queryCapabilities.flatMap((capability) => {
    const supportsExplain = capability.supports_explain !== false;
    return capability.query_packs.map((queryPack) => ({
      capability_id: capability.capability_id,
      pack_id: queryPack.pack_id,
      query_modes: [...queryPack.query_modes],
      supports_explain: supportsExplain,
    }));
  });
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}
