import type { WebMcpTool } from '@ocp-catalog/webmcp-adapter';
import type { CatalogQueryItem, CatalogSearchItem, QuerySession, ResolvableReference, SavedCatalogProfile } from '../api';

export type OcpUserDemoWebMcpContext = {
  getState: () => {
    savedProfiles: SavedCatalogProfile[];
    pendingCatalog: CatalogSearchItem | null;
    activeProfile: SavedCatalogProfile | null;
    catalogResults: CatalogQueryItem[];
    resolvedItem: ResolvableReference | null;
    querySession: QuerySession | null;
    busyAction: string | null;
  };
  submitUserIntent: (message: string) => Promise<void>;
  confirmPendingCatalog: () => Promise<void>;
  selectCatalogProfile: (catalogId: string) => void;
  resolveResultEntry: (entryId: string) => Promise<void>;
  openResolvedAction: (actionId: string) => void;
};

type ContextRef = {
  current: OcpUserDemoWebMcpContext;
};

export function createOcpUserDemoWebMcpTools(contextRef: ContextRef): WebMcpTool[] {
  return [
    {
      name: 'ocp.get_page_state',
      description: 'Return a safe summary of the current OCP user demo page state.',
      handler: () => summarizeState(contextRef.current.getState()),
    },
    {
      name: 'ocp.submit_user_intent',
      description: 'Submit a user intent message through the existing OCP user demo flow.',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string' },
        },
        required: ['message'],
      },
      handler: async (input) => {
        const { message } = parseObject(input);
        if (typeof message !== 'string' || !message.trim()) {
          throw new Error('message must be a non-empty string');
        }

        await contextRef.current.submitUserIntent(message);
        return { ok: true };
      },
    },
    {
      name: 'ocp.confirm_pending_catalog',
      description: 'Confirm and save the pending catalog, then continue the existing query flow.',
      handler: async () => {
        if (!contextRef.current.getState().pendingCatalog) {
          throw new Error('No pending catalog is available to confirm');
        }

        await contextRef.current.confirmPendingCatalog();
        return { ok: true };
      },
    },
    {
      name: 'ocp.select_catalog_profile',
      description: 'Select a saved local catalog profile by catalog id.',
      inputSchema: {
        type: 'object',
        properties: {
          catalogId: { type: 'string' },
        },
        required: ['catalogId'],
      },
      handler: (input) => {
        const { catalogId } = parseObject(input);
        if (typeof catalogId !== 'string' || !catalogId.trim()) {
          throw new Error('catalogId must be a non-empty string');
        }

        contextRef.current.selectCatalogProfile(catalogId);
        return { ok: true };
      },
    },
    {
      name: 'ocp.resolve_result_entry',
      description: 'Resolve an entry from the currently visible catalog results.',
      inputSchema: {
        type: 'object',
        properties: {
          entryId: { type: 'string' },
        },
        required: ['entryId'],
      },
      handler: async (input) => {
        const { entryId } = parseObject(input);
        if (typeof entryId !== 'string' || !entryId.trim()) {
          throw new Error('entryId must be a non-empty string');
        }

        await contextRef.current.resolveResultEntry(entryId);
        return { ok: true };
      },
    },
    {
      name: 'ocp.open_resolved_action',
      description: 'Open an action exposed by the currently resolved item.',
      inputSchema: {
        type: 'object',
        properties: {
          actionId: { type: 'string' },
        },
        required: ['actionId'],
      },
      handler: (input) => {
        const { actionId } = parseObject(input);
        if (typeof actionId !== 'string' || !actionId.trim()) {
          throw new Error('actionId must be a non-empty string');
        }

        const resolvedItem = contextRef.current.getState().resolvedItem;
        if (!resolvedItem) {
          throw new Error('No resolved item is available');
        }

        const action = resolvedItem.action_bindings.find((item) => item.action_id === actionId);
        if (!action) {
          throw new Error(`Action ${actionId} is not available on the current resolved item`);
        }

        contextRef.current.openResolvedAction(action.action_id);
        return { ok: true };
      },
    },
  ];
}

function summarizeState(state: ReturnType<OcpUserDemoWebMcpContext['getState']>) {
  return {
    busyAction: state.busyAction,
    activeCatalogId: state.activeProfile?.catalog_id ?? null,
    savedProfiles: state.savedProfiles.map(summarizeProfile),
    pendingCatalog: state.pendingCatalog ? summarizeCatalog(state.pendingCatalog) : null,
    querySession: state.querySession ? summarizeQuerySession(state.querySession) : null,
    results: state.catalogResults.map((item) => ({
      entryId: item.entry_id,
      title: item.title,
      summary: item.summary,
      score: item.score,
      providerId: item.provider_id,
      objectId: item.object_id,
    })),
    resolvedItem: state.resolvedItem ? {
      id: state.resolvedItem.id,
      entryId: state.resolvedItem.entry_id,
      title: state.resolvedItem.title,
      providerId: state.resolvedItem.provider_id,
      objectType: state.resolvedItem.object_type,
      actions: state.resolvedItem.action_bindings.map((action) => ({
        actionId: action.action_id,
        actionType: action.action_type,
        label: action.label,
        method: action.method ?? 'GET',
        canOpen: Boolean(action.url),
      })),
    } : null,
  };
}

function summarizeProfile(profile: SavedCatalogProfile) {
  return {
    catalogId: profile.catalog_id,
    catalogName: profile.catalog_name,
    verificationStatus: profile.verification_status,
    trustTier: profile.trust_tier,
    healthStatus: profile.health_status,
    supportedQueryPacks: profile.route_hint.supported_query_packs,
  };
}

function summarizeCatalog(catalog: CatalogSearchItem) {
  return {
    catalogId: catalog.catalog_id,
    catalogName: catalog.catalog_name,
    description: catalog.description,
    verificationStatus: catalog.verification_status,
    trustTier: catalog.trust_tier,
    healthStatus: catalog.health_status,
    supportedQueryPacks: catalog.route_hint.supported_query_packs,
    matchedQueryCapabilities: catalog.matched_query_capabilities,
  };
}

function summarizeQuerySession(session: QuerySession) {
  return {
    baseIntent: session.baseIntent,
    latestUserTurn: session.latestUserTurn,
    activeFilters: session.activeFilters,
    queryMode: session.queryMode,
    queryPack: session.queryPack,
    sortPreference: session.sortPreference,
    searchSteps: session.searchSteps?.map((step) => ({
      purpose: step.purpose,
      queryPack: step.query_pack,
      filters: step.filters,
    })),
  };
}

function parseObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('tool input must be an object');
  }

  return input as Record<string, unknown>;
}
