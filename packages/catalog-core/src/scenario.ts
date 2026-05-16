import type {
  ActionBinding,
  CatalogManifest,
  CommercialObject,
  ObjectContract,
  ResolveRequest,
} from '@ocp-catalog/ocp-schema';

export type DescriptorValidationResult =
  | { ok: true; data?: unknown }
  | { ok: false; errors: string[] };

export type SearchProjection = Record<string, unknown> & {
  title: string;
  summary?: string;
  source_url?: string;
  text?: string;
};

/**
 * Context passed to `buildResolveActions`, enabling scenarios to:
 *   - know which entry is being resolved (entryId)
 *   - read the original resolve request (e.g. request.agent.agent_id)
 *   - perform async I/O (e.g. callback to a Provider) via injected fetch
 *
 * Injecting `fetch` keeps the scenario module testable (mock fetch in tests).
 */
export interface ResolveContext {
  entryId: string;
  request: ResolveRequest;
  fetch: typeof globalThis.fetch;
}

export type CatalogScenarioModule = {
  description?: string;
  registryVisibility?: CatalogManifest['registry_visibility'];
  objectContracts(): ObjectContract[];
  providerFieldRules?(): CatalogManifest['provider_contract']['field_rules'];
  providerSyncCapabilities?(): CatalogManifest['provider_contract']['sync_capabilities'];
  queryCapabilities(): CatalogManifest['query_capabilities'];
  validateDescriptorPack(packId: string, data: unknown): DescriptorValidationResult;
  buildSearchProjection(object: CommercialObject): SearchProjection;
  buildExplainProjection?(object: CommercialObject, projection: SearchProjection): Record<string, unknown>;
  buildEmbeddingText?(object: CommercialObject, projection: SearchProjection): string | null | undefined;
  /**
   * Build action_bindings for the resolved object.
   *
   * Return type is `ActionBinding[] | Promise<ActionBinding[]>`:
   *   - sync return preserves backward compatibility with old scenarios
   *   - async return allows scenarios to call out to Providers / external services
   *
   * The `ctx` parameter was added in 2026-05. Old scenarios that ignored it
   * remain source-compatible because extra positional parameters in TS function
   * types are accepted silently.
   */
  buildResolveActions?(
    projection: Record<string, unknown>,
    ctx: ResolveContext,
  ): ActionBinding[] | Promise<ActionBinding[]>;
};

export function defaultProviderFieldRules(): CatalogManifest['provider_contract']['field_rules'] {
  return [
    {
      field_ref: 'provider#/display_name',
      requirement: 'required',
      usage: ['identity', 'display'],
    },
    {
      field_ref: 'provider#/homepage',
      requirement: 'required',
      usage: ['identity', 'reference'],
    },
  ];
}

export function defaultProviderSyncCapabilities(): CatalogManifest['provider_contract']['sync_capabilities'] {
  return [];
}
