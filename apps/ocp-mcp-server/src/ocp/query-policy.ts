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
    query_mode?: QueryMode;
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

  const queryMode = input.query_mode ?? inferBaseMode(input.query ?? '', input.filters ?? {});
  const selected = requestedDescriptor
    ?? descriptors.find((descriptor) => descriptor.query_modes.includes(queryMode));

  if (!selected) {
    if (descriptors.length === 0) {
      throw new McpToolError('invalid_query_pack', 'catalog manifest does not declare any query packs', {
        supported_query_packs: supportedPacks,
      });
    }

    throw new McpToolError('invalid_query_mode', `catalog manifest does not support query mode ${queryMode}`, {
      query_mode: queryMode,
      supported_query_modes: unique(descriptors.flatMap((descriptor) => descriptor.query_modes)),
      supported_query_packs: supportedPacks,
    });
  }

  if (!selected.query_modes.includes(queryMode)) {
    throw new McpToolError('invalid_query_mode', `query_pack ${selected.pack_id} does not support query mode ${queryMode}`, {
      query_pack: selected.pack_id,
      query_mode: queryMode,
      supported_query_modes: selected.query_modes,
    });
  }

  if (queryMode === 'semantic' && !(input.query ?? '').trim()) {
    throw new McpToolError('invalid_query', 'semantic query requires a non-empty query', {
      query_pack: selected.pack_id,
      query_mode: queryMode,
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

function inferBaseMode(query: string, filters: Record<string, unknown>): QueryMode {
  const hasQuery = query.trim().length > 0;
  const hasFilters = Object.values(filters).some(Boolean);
  if (hasQuery && hasFilters) return 'hybrid';
  if (hasFilters) return 'filter';
  if (!hasQuery) return 'filter';
  return 'keyword';
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}
