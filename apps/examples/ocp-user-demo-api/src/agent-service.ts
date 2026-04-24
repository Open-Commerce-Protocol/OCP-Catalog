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
  queryPack: z.string().optional(),
  searchSteps: z.array(z.object({
    purpose: z.string(),
    catalog_query: z.string(),
    query_pack: z.string().optional(),
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
    }).optional(),
  })).optional(),
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

type CenterSelectionPlan = {
  intent_summary: string;
  center_search_query: string;
};

type CatalogQueryPlan = {
  intent_summary: string;
  catalog_query: string;
  query_pack?: string;
  search_steps?: Array<{
    purpose: string;
    catalog_query: string;
    query_pack?: string;
    filters?: {
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
  }>;
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

type QueryPackInput = {
  queryPack?: string;
  queryText?: string | null;
  filters?: QuerySession['activeFilters'] | CatalogQueryPlan['filters'];
};

const centerSelectionPlanSchema = z.object({
  intent_summary: z.string().min(1),
  center_search_query: z.string().min(1),
});

const catalogQueryPlanSchema = z.object({
  intent_summary: z.string().min(1),
  catalog_query: z.string().min(1),
  query_pack: z.string().min(1).optional(),
  search_steps: z.array(z.object({
    purpose: z.string().min(1),
    catalog_query: z.string().min(1),
    query_pack: z.string().min(1).optional(),
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
    }).optional(),
  })).max(3).optional(),
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

function isUsableCenterCatalog(item: { verification_status: string; health_status: string }) {
  const verificationOk = item.verification_status === 'verified' || item.verification_status === 'not_required';
  return verificationOk && item.health_status === 'healthy';
}

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

    if (request.saved_profiles.length === 0) {
      const centerPlan = await this.planCenterSelection({
        userInput: request.user_input,
      });
      const center = await this.searchCenter(centerPlan.center_search_query, {
        supportsResolve: true,
      });
      const candidate = center.items.find((item) => isUsableCenterCatalog(item)) ?? null;
      if (!candidate) {
        const fallback = await this.searchCenter('', {
          supportsResolve: true,
        });
        const message = await this.summarizeCenterMiss(
          request.user_input,
          null,
          centerPlan.center_search_query,
          fallback.items,
        );
        return {
          agent_message: message,
          pending_catalog: null,
          next_session: null,
          result_items: [] as CatalogQueryItem[],
          selected_catalog_id: null,
        };
      }

      const queryPlan = await this.planCatalogQuery({
        userInput: request.user_input,
        session: request.session ?? null,
        routeHint: candidate.route_hint,
        previousResults: request.previous_results,
      });
      const normalizedSession = buildNextSession(queryPlan, request.user_input, candidate.route_hint.supported_query_packs);
      const message = await this.summarizeCatalogChoice(request.user_input, candidate);
      return {
        agent_message: message,
        pending_catalog: candidate,
        next_session: normalizedSession,
        result_items: [] as CatalogQueryItem[],
        selected_catalog_id: null,
      };
    }

    const selectedProfile = pickProfile(request.saved_profiles, request.active_catalog_id);
    const queryPlan = await this.planCatalogQuery({
      userInput: request.user_input,
      session: request.session ?? null,
      routeHint: selectedProfile.route_hint,
      previousResults: request.previous_results,
    });
    const normalizedSession = buildNextSession(queryPlan, request.user_input, selectedProfile.route_hint.supported_query_packs);
    const items = await this.executeCatalogSearchPlan(selectedProfile.route_hint, queryPlan, normalizedSession);
    const message = await this.summarizeCatalogResults(request.user_input, selectedProfile.catalog_name, normalizedSession, items, false, queryPlan);

    return {
      agent_message: message,
      pending_catalog: null,
      next_session: normalizedSession,
      result_items: items,
      selected_catalog_id: selectedProfile.catalog_id,
    };
  }

  async confirmRegistration(input: unknown) {
    const request = confirmRegistrationRequestSchema.parse(input);
    const normalizedSession = buildNextSession({
      intent_summary: request.session.baseIntent,
      catalog_query: request.session.baseIntent,
      query_pack: request.session.queryPack,
      sort_preference: request.session.sortPreference ?? 'relevance',
      filters: request.session.activeFilters,
    }, request.session.latestUserTurn, request.pending_catalog.route_hint.supported_query_packs);
    const fallbackPlan: CatalogQueryPlan = {
      intent_summary: normalizedSession.baseIntent,
      catalog_query: normalizedSession.baseIntent,
      query_pack: normalizedSession.queryPack,
      search_steps: request.session.searchSteps,
      sort_preference: normalizedSession.sortPreference ?? 'relevance',
      filters: normalizedSession.activeFilters,
    };
    const items = await this.executeCatalogSearchPlan(request.pending_catalog.route_hint, fallbackPlan, normalizedSession);
    const message = await this.summarizeCatalogResults(
      normalizedSession.baseIntent,
      request.pending_catalog.catalog_name,
      normalizedSession,
      items,
      true,
      fallbackPlan,
    );

    return {
      agent_message: message,
      next_session: normalizedSession,
      result_items: items,
      selected_catalog_id: request.pending_catalog.catalog_id,
    };
  }

  private async planCenterSelection(input: {
    userInput: string;
  }) {
    const draft = await this.model.completeJson<CenterSelectionPlan>(
      [
        'You are an OCP user-side agent and catalog-selection planner.',
        'OCP Catalog is not limited to shopping. It can discover commercial objects such as products, services, jobs, talent profiles, local appointments, B2B capabilities, and workflow entry points.',
        'Your job in this phase is only to decide how to search OCP Center for a suitable catalog.',
        'When selecting catalogs, inspect catalog profiles carefully (description, metadata.query_hints, supported_query_packs, trust/health), not just catalog_name.',
        'Some catalog names are broad and do not reveal exact inventory scope. Do not over-constrain by literal category names if profile signals a broader commerce scope.',
        'Example: if user wants to buy clothes, an e-commerce catalog profile can be a valid candidate even when catalog_name does not explicitly contain a clothing category.',
        'Do not plan query_pack, sort, or catalog filters in this phase.',
        'Do not assume a catalog before Center discovery happens.',
        'Return JSON only.',
        'Schema:',
        JSON.stringify(z.toJSONSchema(centerSelectionPlanSchema), null, 2),
      ].join('\n'),
      JSON.stringify({
        user_input: input.userInput,
      }, null, 2),
    );

    return centerSelectionPlanSchema.parse(draft);
  }

  private async planCatalogQuery(input: {
    userInput: string;
    session: QuerySession | null;
    routeHint: SavedCatalogProfile['route_hint'] | CatalogSearchItem['route_hint'];
    previousResults: CatalogQueryItem[];
  }) {
    const draft = await this.model.completeJson<CatalogQueryPlan>(
      [
        'You are an OCP user-side agent and catalog-query planner.',
        'The selected catalog may be a commerce, local service, job, talent, B2B, or other commercial-object catalog.',
        'A catalog has already been selected. Your job in this phase is to produce a valid query plan for that selected catalog only.',
        'Decide how to refine the user request into a catalog query plan.',
        'You may plan up to 3 search_steps when one query is not enough. Use this for multi-round retrieval, for example broad discovery first, then focused refinements, then a fallback wording.',
        'Each search_step is a real catalog query the agent will execute before answering the user. Keep steps distinct and useful; do not duplicate the same query.',
        'You must follow the selected catalog declaration before planning the query.',
        'Interaction rules:',
        '1. Inspect the selected catalog route_hint.supported_query_packs and metadata.query_hints before setting query_pack.',
        '2. Only use a query_pack value that exactly matches one of the supported_query_packs declared by the selected catalog.',
        '3. Never invent query_pack ids, never use natural-language placeholders such as "catalog", "search", or "product".',
        '4. If the catalog does not clearly support the pack you want, choose a compatible declared pack or leave query_pack empty.',
        '5. Do not output catalog-specific planning fields unless the selected catalog explicitly declares them as request fields.',
        '6. Prefer using the selected catalog route_hint metadata over assumptions.',
        '7. If catalog_name is broad, use profile signals (description, query_hints, supported_query_packs) to infer capability; do not reject a suitable commerce catalog only because its name is generic.',
        '8. For requests like buying clothes, treat a general e-commerce catalog as valid when profile indicates product-search capability.',
        'Return JSON only.',
        'Supported filters in the current demo runtime: category, brand, currency, availability_status, provider_id, sku, min_amount, max_amount, in_stock_only, has_image.',
        'Use canonical query_pack ids when you set query_pack.',
        'Preferred mappings: free-text search -> ocp.query.keyword.v1, filter-only listing -> ocp.query.filter.v1, semantic intent -> ocp.query.semantic.v1 when available.',
        'Use sort_preference price_asc only when the selected catalog appears price-oriented and the user clearly asks for cheaper/lower price.',
        'When the user speaks Chinese but the available catalog metadata indicates English-oriented search, you may translate the search phrase to English.',
        'If semantic query is declared and the user gives a broad meaning-based request, prefer semantic for at least one search_step. If keyword is better for exact product names, brands, SKUs, or categories, use keyword.',
        'Always return all fields in the schema.',
        'Schema:',
        JSON.stringify(z.toJSONSchema(catalogQueryPlanSchema), null, 2),
      ].join('\n'),
      JSON.stringify({
        user_input: input.userInput,
        current_session: input.session,
        selected_catalog: {
          catalog_id: input.routeHint.catalog_id,
          catalog_name: input.routeHint.catalog_name,
          query_url: input.routeHint.query_url,
          supported_query_packs: input.routeHint.supported_query_packs,
          metadata: input.routeHint.metadata,
          verification_status: input.routeHint.verification_status,
          trust_tier: input.routeHint.trust_tier,
          health_status: input.routeHint.health_status,
        },
        protocol_notes: {
          query_pack_must_match_catalog_declaration: true,
          allowed_known_query_packs: [
            'ocp.query.keyword.v1',
            'ocp.query.filter.v1',
            'ocp.query.semantic.v1',
          ],
          if_unknown_or_unsupported_query_pack: 'omit_query_pack_or_choose_supported_declared_pack',
        },
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

    return catalogQueryPlanSchema.parse(draft);
  }

  private async summarizeCatalogChoice(userInput: string, candidate: CatalogSearchItem) {
    return await this.model.completeText(
      'You are a Chinese OCP user-side agent. Explain briefly why this catalog is a good candidate for the user intent and ask for explicit permission to save its profile locally. Do not expose raw protocol details.',
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
      'You are a Chinese OCP user-side agent. The user already has a pending catalog candidate, but local registration still requires explicit user consent. Explain the current state briefly and ask the user to explicitly authorize saving the catalog profile before you continue. Do not expose raw protocol details.',
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
    session: QuerySession | null,
    centerSearchQuery: string,
    fallbackItems: CatalogSearchItem[],
  ) {
    const hasUsableCandidate = fallbackItems.some((item) => isUsableCenterCatalog(item));
    const blockedCandidates = fallbackItems
      .filter((item) => !isUsableCenterCatalog(item))
      .slice(0, 5)
      .map((item) => ({
        catalog_name: item.catalog_name,
        verification_status: item.verification_status,
        trust_tier: item.trust_tier,
        health_status: item.health_status,
      }));

    return await this.model.completeText(
      [
        'You are a Chinese OCP user-side agent.',
        'No immediately usable catalog candidate was found from OCP Center for the current request.',
        'Treat catalogs with verification_status "verified" or "not_required" and health_status "healthy" as usable.',
        'If fallback items exist but are blocked by trust or health status, explain clearly that catalogs may already be registered in Center, but they are not yet usable for the agent.',
        'If there are usable fallback items, explain that Center has catalogs but the current request did not match their metadata well enough.',
        'If there are no fallback items at all, explain that Center currently has no usable catalogs.',
        'Keep it concise.',
        'Use Markdown bullet points when listing follow-up suggestions.',
        'Do not expose raw protocol details beyond mentioning registration status or health when necessary.',
      ].join(' '),
      JSON.stringify({
        user_input: userInput,
        center_search_query: centerSearchQuery,
        session,
        has_usable_fallback_candidate: hasUsableCandidate,
        fallback_catalogs: blockedCandidates,
      }),
    );
  }

  private async summarizeCatalogResults(
    userInput: string,
    catalogName: string,
    session: QuerySession,
    items: CatalogQueryItem[],
    justRegistered = false,
    plan?: CatalogQueryPlan,
  ) {
    return await this.model.completeText(
      'You are a Chinese OCP user-side agent. Summarize catalog search results naturally. If there are no items, explain that clearly and suggest how to refine the request. Do not dump raw tool output. Mention the strongest candidates and how the current refinement affected them when results exist. Keep it concise. Do not assume every result is a product; describe entries according to the available fields.',
      JSON.stringify({
        user_input: userInput,
        catalog_name: catalogName,
        just_registered: justRegistered,
        session,
        search_steps: plan?.search_steps?.map((step) => ({
          purpose: step.purpose,
          catalog_query: step.catalog_query,
          query_pack: step.query_pack,
          filters: step.filters,
        })) ?? [{
          purpose: 'single query',
          catalog_query: session.baseIntent,
          query_pack: session.queryPack,
          filters: session.activeFilters,
        }],
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

  private async executeCatalogSearchPlan(
    routeHint: SavedCatalogProfile['route_hint'] | CatalogSearchItem['route_hint'],
    plan: CatalogQueryPlan,
    session: QuerySession,
  ) {
    const steps = normalizeSearchSteps(plan, routeHint.supported_query_packs, session);
    const collected: CatalogQueryItem[] = [];

    for (const step of steps) {
      const result = await this.queryCatalog(routeHint, {
        query: step.query,
        query_pack: step.queryPack,
        filters: step.filters,
      });
      collected.push(...result.items);
    }

    return sortItems(dedupeItems(collected), session.sortPreference);
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

function buildNextSession(plan: CatalogQueryPlan, latestUserTurn: string, supportedQueryPacks: string[]): QuerySession {
  return {
    baseIntent: plan.catalog_query,
    latestUserTurn,
    activeFilters: plan.filters,
    queryPack: normalizeQueryPack(supportedQueryPacks, {
      queryPack: plan.query_pack,
      queryText: plan.catalog_query,
      filters: plan.filters,
    }),
    searchSteps: plan.search_steps,
    sortPreference: plan.sort_preference,
  };
}

function normalizeSearchSteps(
  plan: CatalogQueryPlan,
  supportedQueryPacks: string[],
  session: QuerySession,
) {
  const rawSteps = plan.search_steps?.length
    ? plan.search_steps
    : [{
        purpose: 'primary query',
        catalog_query: plan.catalog_query,
        query_pack: plan.query_pack,
        filters: plan.filters,
      }];

  const normalized = rawSteps
    .slice(0, 3)
    .map((step) => {
      const filters = step.filters ?? plan.filters ?? {};
      const query = step.catalog_query.trim() || plan.catalog_query;
      return {
        query,
        queryPack: normalizeQueryPack(supportedQueryPacks, {
          queryPack: step.query_pack ?? plan.query_pack ?? session.queryPack,
          queryText: query,
          filters,
        }),
        filters,
      };
    });

  const seen = new Set<string>();
  return normalized.filter((step) => {
    const key = JSON.stringify(step);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

function dedupeItems(items: CatalogQueryItem[]) {
  const byEntry = new Map<string, CatalogQueryItem>();
  for (const item of items) {
    const existing = byEntry.get(item.entry_id);
    if (!existing || item.score > existing.score) {
      byEntry.set(item.entry_id, item);
    }
  }
  return [...byEntry.values()].sort((left, right) => right.score - left.score);
}

function normalizeQueryPack(
  supportedQueryPacks: string[],
  input: QueryPackInput,
) {
  if (!Array.isArray(supportedQueryPacks) || supportedQueryPacks.length === 0) return undefined;
  if (input.queryPack && supportedQueryPacks.includes(input.queryPack)) return input.queryPack;

  const hasFilters = Boolean(input.filters && Object.values(input.filters).some((value) => value !== undefined && value !== null && value !== ''));
  const hasQueryText = Boolean(input.queryText?.trim());

  if (hasQueryText && hasFilters && supportedQueryPacks.includes('ocp.query.keyword.v1')) return 'ocp.query.keyword.v1';
  if (!hasQueryText && hasFilters && supportedQueryPacks.includes('ocp.query.filter.v1')) return 'ocp.query.filter.v1';
  if (supportedQueryPacks.includes('ocp.query.semantic.v1')) return 'ocp.query.semantic.v1';
  if (hasQueryText && supportedQueryPacks.includes('ocp.query.keyword.v1')) return 'ocp.query.keyword.v1';
  if (hasFilters && supportedQueryPacks.includes('ocp.query.filter.v1')) return 'ocp.query.filter.v1';

  return supportedQueryPacks[0];
}
