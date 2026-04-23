import type { AppConfig } from '@ocp-catalog/config';
import { z } from 'zod';
import { AgentError } from './errors';
import { OpenAiCompatibleClient } from './openai-compatible-client';

const routeHintSchema = z.object({
  catalog_id: z.string(),
  catalog_name: z.string(),
  description: z.string().optional(),
  manifest_url: z.string().url(),
  query_url: z.string().url(),
  resolve_url: z.string().url().optional(),
  supported_query_packs: z.array(z.string()),
  metadata: z.object({
    query_hints: z.object({
      supported_query_modes: z.array(z.string()).default([]),
      supported_query_languages: z.array(z.string()).default([]),
      content_languages: z.array(z.string()).default([]),
    }).default({
      supported_query_modes: [],
      supported_query_languages: [],
      content_languages: [],
    }),
  }).default({
    query_hints: {
      supported_query_modes: [],
      supported_query_languages: [],
      content_languages: [],
    },
  }),
  verification_status: z.string(),
  trust_tier: z.string(),
  health_status: z.string(),
  snapshot_id: z.string(),
  snapshot_fetched_at: z.string(),
});

const catalogSearchItemSchema = z.object({
  catalog_id: z.string(),
  catalog_name: z.string(),
  description: z.string().optional(),
  score: z.number(),
  matched_query_capabilities: z.array(z.string()),
  verification_status: z.string(),
  trust_tier: z.string(),
  health_status: z.string(),
  route_hint: routeHintSchema,
  explain: z.array(z.string()),
});

const savedProfileSchema = z.object({
  catalog_id: z.string(),
  catalog_name: z.string(),
  route_hint: routeHintSchema,
  verification_status: z.string(),
  trust_tier: z.string(),
  health_status: z.string(),
  registered_at: z.string(),
  last_used_at: z.string(),
});

const querySessionSchema = z.object({
  baseIntent: z.string(),
  latestUserTurn: z.string(),
  activeFilters: z.object({
    category: z.string().optional(),
    brand: z.string().optional(),
    currency: z.string().optional(),
    availability_status: z.string().optional(),
    provider_id: z.string().optional(),
    sku: z.string().optional(),
    min_amount: z.number().optional(),
    max_amount: z.number().optional(),
    in_stock_only: z.boolean().optional(),
    has_image: z.boolean().optional(),
  }),
  queryMode: z.enum(['keyword', 'filter', 'semantic', 'hybrid']).optional(),
  queryPack: z.string().optional(),
  sortPreference: z.enum(['relevance', 'price_asc']).optional(),
});

const catalogQueryItemSchema = z.object({
  entry_id: z.string(),
  provider_id: z.string(),
  object_id: z.string(),
  title: z.string(),
  summary: z.string().optional(),
  score: z.number(),
  attributes: z.record(z.string(), z.unknown()),
  explain: z.array(z.string()),
});

const agentTurnRequestSchema = z.object({
  user_input: z.string().min(1),
  saved_profiles: z.array(savedProfileSchema).default([]),
  active_catalog_id: z.string().nullable().optional(),
  pending_catalog: catalogSearchItemSchema.nullable().optional(),
  session: querySessionSchema.nullable().optional(),
  previous_results: z.array(catalogQueryItemSchema).default([]),
});

const confirmRegistrationRequestSchema = z.object({
  pending_catalog: catalogSearchItemSchema,
  session: querySessionSchema,
});

type SavedCatalogProfile = z.infer<typeof savedProfileSchema>;
type QuerySession = z.infer<typeof querySessionSchema>;
type CatalogSearchItem = z.infer<typeof catalogSearchItemSchema>;
type CatalogQueryItem = z.infer<typeof catalogQueryItemSchema>;
type SearchCenterOptions = {
  verificationStatus?: string;
  supportsResolve?: boolean;
};

type AgentPlan = {
  intent_summary: string;
  center_search_query: string;
  catalog_query: string;
  query_mode: 'keyword' | 'filter' | 'semantic' | 'hybrid';
  query_pack: string;
  sort_preference: 'relevance' | 'price_asc';
  filters: {
    category?: string;
    brand?: string;
    currency?: string;
    availability_status?: string;
    provider_id?: string;
    sku?: string;
    min_amount?: number;
    max_amount?: number;
    in_stock_only?: boolean;
    has_image?: boolean;
  };
};

const agentPlanSchema = z.object({
  intent_summary: z.string().min(1),
  center_search_query: z.string().min(1),
  catalog_query: z.string().min(1),
  query_mode: z.enum(['keyword', 'filter', 'semantic', 'hybrid']),
  query_pack: z.string().min(1),
  sort_preference: z.enum(['relevance', 'price_asc']),
  filters: z.object({
    category: z.string().optional(),
    brand: z.string().optional(),
    currency: z.string().optional(),
    availability_status: z.string().optional(),
    provider_id: z.string().optional(),
    sku: z.string().optional(),
    min_amount: z.number().optional(),
    max_amount: z.number().optional(),
    in_stock_only: z.boolean().optional(),
    has_image: z.boolean().optional(),
  }),
});

export class UserDemoAgentService {
  private readonly model: OpenAiCompatibleClient;

  constructor(private readonly config: AppConfig) {
    this.model = new OpenAiCompatibleClient(config, config.USER_DEMO_AGENT_MODEL);
  }

  async turn(input: unknown) {
    const request = agentTurnRequestSchema.parse(input);
    if (request.pending_catalog) {
      const message = await this.summarizePendingCatalog(request.user_input, request.pending_catalog, request.session ?? null);
      return {
        agent_message: message,
        pending_catalog: request.pending_catalog,
        next_session: request.session ?? null,
        result_items: [] as CatalogQueryItem[],
        selected_catalog_id: request.active_catalog_id ?? null,
      };
    }

    const plan = await this.planTurn({
      userInput: request.user_input,
      session: request.session ?? null,
      savedProfiles: request.saved_profiles,
      previousResults: request.previous_results,
    });

    if (request.saved_profiles.length === 0) {
      const center = await this.searchCenter(plan.center_search_query, {
        verificationStatus: 'verified',
        supportsResolve: true,
      });
      const candidate = center.items[0] ?? null;
      const nextSession = buildNextSession(plan, request.user_input);
      if (!candidate) {
        const fallback = await this.searchCenter('', {
          supportsResolve: true,
        });
        const message = await this.summarizeCenterMiss(
          request.user_input,
          nextSession,
          plan.center_search_query,
          fallback.items,
        );
        return {
          agent_message: message,
          pending_catalog: null,
          next_session: nextSession,
          result_items: [] as CatalogQueryItem[],
          selected_catalog_id: null,
        };
      }

      const message = await this.summarizeCatalogChoice(request.user_input, candidate);
      return {
        agent_message: message,
        pending_catalog: candidate,
        next_session: nextSession,
        result_items: [] as CatalogQueryItem[],
        selected_catalog_id: null,
      };
    }

    const selectedProfile = pickProfile(request.saved_profiles, request.active_catalog_id);
    const nextSession = buildNextSession(plan, request.user_input);
    const result = await this.queryCatalog(selectedProfile.route_hint, {
      query: nextSession.baseIntent,
      query_pack: nextSession.queryPack,
      filters: nextSession.activeFilters,
    });
    const items = sortItems(result.items, nextSession.sortPreference);
    const message = await this.summarizeCatalogResults(request.user_input, selectedProfile.catalog_name, nextSession, items);

    return {
      agent_message: message,
      pending_catalog: null,
      next_session: nextSession,
      result_items: items,
      selected_catalog_id: selectedProfile.catalog_id,
    };
  }

  async confirmRegistration(input: unknown) {
    const request = confirmRegistrationRequestSchema.parse(input);
    const result = await this.queryCatalog(request.pending_catalog.route_hint, {
      query: request.session.baseIntent,
      query_pack: request.session.queryPack,
      filters: request.session.activeFilters,
    });
    const items = sortItems(result.items, request.session.sortPreference);
    const message = await this.summarizeCatalogResults(
      request.session.baseIntent,
      request.pending_catalog.catalog_name,
      request.session,
      items,
      true,
    );

    return {
      agent_message: message,
      next_session: request.session,
      result_items: items,
      selected_catalog_id: request.pending_catalog.catalog_id,
    };
  }

  private async planTurn(input: {
    userInput: string;
    session: QuerySession | null;
    savedProfiles: SavedCatalogProfile[];
    previousResults: CatalogQueryItem[];
  }) {
    const draft = await this.model.completeJson<AgentPlan>(
      [
        'You are an OCP commerce shopping agent.',
        'Decide how to refine the user request into a catalog query plan.',
        'Return JSON only.',
        'Never auto-register a catalog locally. Registration must be explicit user consent.',
        'Supported filters: category, brand, currency, availability_status, provider_id, sku, min_amount, max_amount, in_stock_only, has_image.',
        'Use sort_preference price_asc only when the user clearly asks for cheaper/lower price.',
        'Use query_mode keyword by default, hybrid when both keyword and filters matter, filter only when there is no search phrase.',
        'When the user speaks Chinese but the available catalog metadata indicates English-oriented search, you may translate the search phrase to English.',
        'Always return all fields in the schema.',
        'Schema:',
        JSON.stringify(z.toJSONSchema(agentPlanSchema), null, 2),
      ].join('\n'),
      JSON.stringify({
        user_input: input.userInput,
        current_session: input.session,
        saved_profiles: input.savedProfiles.map((profile) => ({
          catalog_id: profile.catalog_id,
          catalog_name: profile.catalog_name,
          query_url: profile.route_hint.query_url,
          supported_query_packs: profile.route_hint.supported_query_packs,
          metadata: profile.route_hint.metadata,
        })),
        previous_results: input.previousResults.slice(0, 8).map((item) => ({
          title: item.title,
          provider_id: item.provider_id,
          object_id: item.object_id,
          category: stringValue(item.attributes.category),
          brand: stringValue(item.attributes.brand),
          currency: stringValue(item.attributes.currency),
          availability_status: stringValue(item.attributes.availability_status),
        })),
      }, null, 2),
    );

    return agentPlanSchema.parse(draft);
  }

  private async summarizeCatalogChoice(userInput: string, candidate: CatalogSearchItem) {
    return await this.model.completeText(
      'You are a Chinese shopping agent. Explain briefly why this catalog is a good candidate and ask for explicit permission to save its profile locally. Do not expose raw protocol details.',
      JSON.stringify({
        user_input: userInput,
        candidate: {
          catalog_name: candidate.catalog_name,
          description: candidate.description,
          supported_query_packs: candidate.route_hint.supported_query_packs,
          metadata: candidate.route_hint.metadata,
          trust_tier: candidate.trust_tier,
          verification_status: candidate.verification_status,
          health_status: candidate.health_status,
        },
      }),
    );
  }

  private async summarizePendingCatalog(
    userInput: string,
    candidate: CatalogSearchItem,
    session: QuerySession | null,
  ) {
    return await this.model.completeText(
      'You are a Chinese shopping agent. The user already has a pending catalog candidate, but local registration still requires explicit user consent. Explain the current state briefly and ask the user to explicitly authorize saving the catalog profile before you continue. Do not expose raw protocol details.',
      JSON.stringify({
        user_input: userInput,
        session,
        candidate: {
          catalog_name: candidate.catalog_name,
          description: candidate.description,
          supported_query_packs: candidate.route_hint.supported_query_packs,
          metadata: candidate.route_hint.metadata,
          trust_tier: candidate.trust_tier,
          verification_status: candidate.verification_status,
          health_status: candidate.health_status,
        },
      }),
    );
  }

  private async summarizeCenterMiss(
    userInput: string,
    session: QuerySession,
    centerSearchQuery: string,
    fallbackItems: CatalogSearchItem[],
  ) {
    const hasVerifiedCandidate = fallbackItems.some((item) => item.verification_status === 'verified');
    const unverifiedCandidates = fallbackItems
      .filter((item) => item.verification_status !== 'verified')
      .slice(0, 5)
      .map((item) => ({
        catalog_name: item.catalog_name,
        verification_status: item.verification_status,
        trust_tier: item.trust_tier,
        health_status: item.health_status,
      }));

    return await this.model.completeText(
      [
        'You are a Chinese shopping agent.',
        'No immediately usable verified catalog candidate was found from OCP Center for the current request.',
        'If fallback items exist but are not verified, explain clearly that catalogs may already be registered in Center, but they are not yet usable for the agent because they are not verified.',
        'If there are verified fallback items, explain that Center has catalogs but the current request did not match their metadata well enough.',
        'If there are no fallback items at all, explain that Center currently has no usable catalogs.',
        'Keep it concise.',
        'Use Markdown bullet points when listing follow-up suggestions.',
        'Do not expose raw protocol details beyond mentioning registration versus verification when necessary.',
      ].join(' '),
      JSON.stringify({
        user_input: userInput,
        center_search_query: centerSearchQuery,
        session,
        has_verified_fallback_candidate: hasVerifiedCandidate,
        fallback_catalogs: unverifiedCandidates,
      }),
    );
  }

  private async summarizeCatalogResults(
    userInput: string,
    catalogName: string,
    session: QuerySession,
    items: CatalogQueryItem[],
    justRegistered = false,
  ) {
    return await this.model.completeText(
      'You are a Chinese shopping agent. Summarize catalog search results naturally. If there are no items, explain that clearly and suggest how to refine the request. Do not dump raw tool output. Mention the strongest candidates and how the current refinement affected them when results exist. Keep it concise.',
      JSON.stringify({
        user_input: userInput,
        catalog_name: catalogName,
        just_registered: justRegistered,
        session,
        result_count: items.length,
        top_items: items.slice(0, 5).map((item) => ({
          title: item.title,
          summary: item.summary,
          provider_id: item.provider_id,
          price: {
            amount: numberValue(item.attributes.amount),
            currency: stringValue(item.attributes.currency),
          },
          availability_status: stringValue(item.attributes.availability_status),
          brand: stringValue(item.attributes.brand),
          category: stringValue(item.attributes.category),
        })),
      }),
    );
  }

  private async searchCenter(query: string, options: SearchCenterOptions = {}) {
    return requestJson<{ items: CatalogSearchItem[] }>(`${this.config.CENTER_PUBLIC_BASE_URL.replace(/\/$/, '')}/ocp/catalogs/search`, {
      ocp_version: '1.0',
      kind: 'CatalogSearchRequest',
      query,
      filters: {
        ...(options.verificationStatus ? { verification_status: options.verificationStatus } : {}),
        ...(options.supportsResolve !== undefined ? { supports_resolve: options.supportsResolve } : {}),
      },
      limit: 10,
      explain: false,
    });
  }

  private async queryCatalog(
    routeHint: SavedCatalogProfile['route_hint'] | CatalogSearchItem['route_hint'],
    request: {
      query: string;
      query_pack?: string;
      filters: QuerySession['activeFilters'];
    },
  ) {
    return requestJson<{ items: CatalogQueryItem[] }>(routeHint.query_url, {
      ocp_version: '1.0',
      kind: 'CatalogQueryRequest',
      catalog_id: routeHint.catalog_id,
      query_pack: request.query_pack,
      query: request.query,
      filters: request.filters,
      limit: 12,
      explain: false,
    });
  }
}

async function requestJson<T>(url: string, body: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new AgentError(response.status, 'validation_error', payload?.error?.message ?? `Request failed with status ${response.status}`, payload);
  }

  return payload as T;
}

function buildNextSession(plan: AgentPlan, latestUserTurn: string): QuerySession {
  return {
    baseIntent: plan.catalog_query,
    latestUserTurn,
    activeFilters: plan.filters,
    queryMode: plan.query_mode,
    queryPack: plan.query_pack,
    sortPreference: plan.sort_preference,
  };
}

function pickProfile(profiles: SavedCatalogProfile[], activeCatalogId?: string | null) {
  if (activeCatalogId) {
    const match = profiles.find((profile) => profile.catalog_id === activeCatalogId);
    if (match) return match;
  }

  const [first] = profiles;
  if (!first) throw new AgentError(400, 'validation_error', 'No local catalog profile is available yet');
  return first;
}

function sortItems(items: CatalogQueryItem[], sortPreference?: 'relevance' | 'price_asc') {
  if (sortPreference !== 'price_asc') return items;

  return [...items].sort((left, right) => {
    const leftValue = numberValue(left.attributes.amount);
    const rightValue = numberValue(right.attributes.amount);
    return leftValue - rightValue || right.score - left.score;
  });
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
