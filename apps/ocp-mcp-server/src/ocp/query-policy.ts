import type { CatalogManifest, CatalogQueryRequest } from '@ocp-catalog/ocp-schema';
import { McpToolError } from '../errors';
import { manifestQueryPackDescriptors, summarizeManifest } from './manifest';

type QueryMode = 'keyword' | 'filter' | 'semantic' | 'hybrid';

export type QueryPolicyDecision = {
  queryPack: string;
  queryMode: QueryMode;
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

export function negotiateQueryPolicy(
  manifest: CatalogManifest,
  input: {
    query_pack?: string;
    query?: string;
    filters?: CatalogQueryRequest['filters'];
  },
): QueryPolicyDecision {
  const descriptors = manifestQueryPackDescriptors(manifest);
  const supportedPacks = descriptors.map((descriptor) => descriptor.pack_id);
  const requested = input.query_pack;
  const requestedDescriptor = requested
    ? descriptors.find((descriptor) => descriptor.pack_id === requested)
    : undefined;

  if (requested && !requestedDescriptor) {
    throw new McpToolError('invalid_query_pack', `unsupported query_pack: ${requested}`, {
      query_pack: requested,
      supported_query_packs: summarizeManifest(manifest).supported_query_packs,
    });
  }

  if (requestedDescriptor && requestedDescriptor.query_modes.length === 0) {
    throw new McpToolError('invalid_query_pack', `query_pack ${requestedDescriptor.pack_id} does not declare query_modes`, {
      query_pack: requestedDescriptor.pack_id,
      supported_query_packs: supportedPacks,
    });
  }

  const queryMode = requestedDescriptor
    ? inferModeForPack(requestedDescriptor.query_modes, input.query ?? '', input.filters ?? {})
    : inferModeForManifest(descriptors, input.query ?? '', input.filters ?? {});
  const selected = requestedDescriptor
    ?? descriptors.find((descriptor) => descriptor.query_modes.includes(queryMode))
    ?? descriptors[0];

  if (!selected) {
    throw new McpToolError('invalid_query_pack', 'catalog manifest does not declare any query packs', {
      supported_query_packs: supportedPacks,
    });
  }

  if (!selected.query_modes.includes(queryMode)) {
    throw new McpToolError('invalid_query_pack', `query_pack ${selected.pack_id} does not support query mode ${queryMode}`, {
      query_pack: selected.pack_id,
      supported_query_modes: selected.query_modes,
    });
  }

  const supportedFilterFields = summarizeManifest(manifest).supported_filter_fields;
  const filterFields = Object.entries(input.filters ?? {})
    .filter(([, value]) => value !== undefined && value !== false)
    .map(([field]) => field)
    .sort();
  const rejectedFilters = supportedFilterFields.length === 0
    ? []
    : filterFields.filter((field) => !supportedFilterFields.includes(field));

  return {
    queryPack: selected.pack_id,
    queryMode,
    supportsExplain: selected.supports_explain,
    policySummary: {
      selected_capability_id: selected.capability_id,
      selected_query_pack: selected.pack_id,
      query_mode: queryMode,
      supports_explain: selected.supports_explain,
      accepted_filters: filterFields.filter((field) => !rejectedFilters.includes(field)),
      rejected_filters: rejectedFilters,
      warnings: selected.supports_explain ? [] : ['Selected query capability does not support explain output.'],
    },
  };
}

function inferModeForManifest(
  descriptors: ReturnType<typeof manifestQueryPackDescriptors>,
  query: string,
  filters: Record<string, unknown>,
) {
  const desired = inferBaseMode(query, filters);
  if (descriptors.some((descriptor) => descriptor.query_modes.includes(desired))) return desired;

  const fallbackOrder: QueryMode[] = desired === 'hybrid'
    ? ['keyword', 'filter', 'semantic']
    : ['filter', 'keyword', 'hybrid', 'semantic'];
  return fallbackOrder.find((mode) => descriptors.some((descriptor) => descriptor.query_modes.includes(mode))) ?? desired;
}

function inferModeForPack(
  queryModes: QueryMode[],
  query: string,
  filters: Record<string, unknown>,
) {
  const hasQuery = query.trim().length > 0;
  const hasFilters = Object.values(filters).some(Boolean);

  if (queryModes.includes('semantic')) return 'semantic';
  if (hasQuery && hasFilters && queryModes.includes('hybrid')) return 'hybrid';
  if (!hasQuery && queryModes.includes('filter')) return 'filter';
  if (hasQuery && queryModes.includes('keyword')) return 'keyword';
  if (queryModes.includes('hybrid')) return 'hybrid';
  if (queryModes.includes('filter')) return 'filter';
  if (queryModes.includes('keyword')) return 'keyword';
  return queryModes[0] ?? inferBaseMode(query, filters);
}

function inferBaseMode(query: string, filters: Record<string, unknown>): QueryMode {
  const hasQuery = query.trim().length > 0;
  const hasFilters = Object.values(filters).some(Boolean);
  if (hasQuery && hasFilters) return 'hybrid';
  if (hasFilters) return 'filter';
  if (!hasQuery) return 'filter';
  return 'keyword';
}
