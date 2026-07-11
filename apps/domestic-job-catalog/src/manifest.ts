import type { AppConfig } from "./config";

const PACKS = {
  posting: "ocp.job.domestic.posting.v1",
  company: "ocp.job.domestic.company.v1",
  location: "ocp.job.domestic.location.v1",
  compensation: "ocp.job.domestic.compensation.v1",
  requirements: "ocp.job.domestic.requirements.v1",
  delivery: "ocp.job.domestic.delivery.v1",
  matching: "ocp.job.domestic.matching.v1",
};

export function buildDiscovery(config: AppConfig) {
  return {
    ocp_version: "1.0",
    kind: "WellKnownCatalogDiscovery",
    catalog_id: config.catalogId,
    catalog_name: config.catalogName,
    manifest_url: `${config.publicBaseUrl}/ocp/manifest`,
    health_url: `${config.publicBaseUrl}/ocp/health`,
    query_url: `${config.publicBaseUrl}/ocp/query`,
    resolve_url: `${config.publicBaseUrl}/ocp/resolve`,
    contracts_url: `${config.publicBaseUrl}/ocp/contracts`,
  };
}

export function buildManifest(config: AppConfig, dataProfile: Record<string, unknown>) {
  const base = config.publicBaseUrl;
  return {
    ocp_version: "1.0",
    kind: "CatalogManifest",
    id: `manifest_${config.catalogId}`,
    catalog_id: config.catalogId,
    catalog_name: config.catalogName,
    description: "Private OCP Catalog node for domestic directly actionable job matching.",
    registry_visibility: "public",
    endpoints: {
      health: { url: `${base}/ocp/health`, method: "GET" },
      query: { url: `${base}/ocp/query`, method: "POST" },
      resolve: { url: `${base}/ocp/resolve`, method: "POST" },
      contracts: { url: `${base}/ocp/contracts`, method: "GET" },
      object_sync: { url: `${base}/ocp/objects/sync`, method: "POST" },
      object_sync_stream: { url: `${base}/ocp/objects/sync/stream`, method: "POST" },
    },
    query_capabilities: [
      {
        capability_id: "ocp.job.domestic.matching.v1",
        name: "Domestic job matching",
        description: "Searches domestic actionable jobs using hard filters, catalog-owned embeddings, and structured reranking for supported job modes.",
        query_packs: [
          {
            pack_id: "ocp.job.domestic.filter.v1",
            description: "Structured domestic job browsing. This pack is filter-only and never enters technical reranking.",
            query_modes: ["filter"],
            metadata: {
              ranking_policy: {
                candidate_generation: "postgres_filter",
                rerank: "none",
                allowed_matching_modes: ["computer", "filter_only"],
                excluded_classification_statuses: ["review_required", "unclassified"],
              },
            },
          },
          {
            pack_id: "ocp.job.domestic.match_candidate.v1",
            description: "Candidate-to-job matching. The caller supplies structured candidate_profile; the catalog computes embeddings and reranks computer jobs.",
            query_modes: ["semantic", "hybrid"],
            metadata: {
              ranking_policy: {
                candidate_generation: "hard_filters_then_catalog_embedding_vector_recall",
                rerank: "computer_jobs_only",
                reranked_matching_modes: ["computer"],
                filter_only_matching_modes: ["filter_only"],
                failure_policy: "Missing candidate_profile, disabled embeddings, missing vectors, or incompatible dimensions fail explicitly; filter-only results are not returned as semantic fallback.",
              },
              embedding: {
                owner: "catalog",
                model: config.embedding.model,
                dimension: config.embedding.dimension,
                query_inputs: ["candidate_profile.basic_info", "candidate_profile.skills", "candidate_profile.work_experiences", "candidate_profile.projects", "candidate_profile.target"],
              },
            },
          },
          {
            pack_id: "ocp.query.keyword.v1",
            description: "Keyword search over active domestic jobs. It does not run semantic retrieval.",
            query_modes: ["keyword"],
          },
          {
            pack_id: "ocp.query.semantic.v1",
            description: "Semantic domestic job retrieval over catalog-owned job embeddings.",
            query_modes: ["semantic", "hybrid"],
            metadata: {
              semantic_search: {
                enabled: config.semanticEnabled,
                embedding_index: config.openSearch.index,
              },
            },
          },
        ],
        input_fields: [
          { name: "query_pack", type: "string", required: false },
          { name: "query", type: "string", required: false },
          { name: "candidate_profile", type: "object", required: false, description: "Required for ocp.job.domestic.match_candidate.v1." },
          { name: "filters.city", type: "string", required: false },
          { name: "filters.cities", type: "array<string>", required: false },
          { name: "filters.recruitment_type", type: "string", required: false },
          { name: "filters.matching_mode", type: "string", required: false },
          { name: "filters.job_family", type: "string", required: false },
          { name: "filters.salary_min", type: "number", required: false },
          { name: "filters.salary_max", type: "number", required: false },
          { name: "limit", type: "number", required: false, default: 20, maximum: config.maxQueryLimit },
          { name: "offset", type: "number", required: false, default: 0 },
        ],
        searchable_field_refs: [
          `${PACKS.posting}#/title`,
          `${PACKS.posting}#/description`,
          `${PACKS.company}#/company`,
          `${PACKS.requirements}#/skills`,
        ],
        filterable_field_refs: [
          `${PACKS.location}#/city`,
          `${PACKS.location}#/province`,
          `${PACKS.matching}#/recruitment_type`,
          `${PACKS.matching}#/matching_mode`,
          `${PACKS.matching}#/job_family`,
          `${PACKS.compensation}#/salary_min`,
          `${PACKS.delivery}#/job_status`,
        ],
        sortable_field_refs: [],
        supports_explain: true,
        supports_resolve: true,
        metadata: {
          no_silent_fallback: true,
          rerank_policy: "computer_only",
        },
      },
    ],
    object_contracts: [
      {
        required_fields: [
          `${PACKS.posting}#/title`,
          `${PACKS.posting}#/description`,
          `${PACKS.company}#/company`,
          `${PACKS.location}#/city`,
          `${PACKS.delivery}#/apply_url`,
          `${PACKS.delivery}#/job_status`,
          `${PACKS.matching}#/recruitment_type`,
          `${PACKS.matching}#/matching_mode`,
          `${PACKS.matching}#/job_family`,
        ],
        optional_fields: [
          `${PACKS.compensation}#/salary_min`,
          `${PACKS.compensation}#/salary_max`,
          `${PACKS.requirements}#/skills`,
          `${PACKS.requirements}#/experiences`,
        ],
        additional_fields_policy: "allow",
        identity_policy: {
          accepted_identity_keys: ["provider_object_id", "canonical_url", "content_hash"],
          dedupe_scope: "provider",
          provider_sku_trust: "not_accepted",
          requires_authority_verification: false,
        },
        resolve_policy: {
          strategies: ["source_url"],
          requires_live_check: false,
          provider_endpoint_required: false,
        },
      },
    ],
    data_profile: sanitizeDataProfile(dataProfile),
    provider_contract: {
      field_rules: [
        { field_ref: "provider#/display_name", requirement: "required", usage: ["identity", "display"] },
        { field_ref: "provider#/homepage", requirement: "required", usage: ["identity", "reference"] },
      ],
      sync_capabilities: [
        {
          capability_id: "ocp.push.batch",
          description: "Provider pushes domestic job objects to the catalog. Invalid records fail explicitly and are not queryable.",
          direction: "provider_to_catalog",
          transport: "http_push",
          sync_model: { snapshot: true, delta: false, stream: true },
          mutation_semantics: { upsert: true, delete: false },
          batching: { enabled: true, max_items: 1000, max_bytes: 10485760 },
          auth: { schemes: ["x-api-key"] },
          endpoint_contract: {
            hosted_by: "catalog",
            path_hint: "/ocp/objects/sync",
            required_endpoint_fields: [],
          },
          metadata: {
            stream_endpoint_path: "/ocp/objects/sync/stream",
          },
        },
      ],
    },
  };
}

function sanitizeDataProfile(dataProfile: Record<string, unknown>) {
  return {
    catalog_entry_count: numberValue(dataProfile.catalog_entry_count),
    object_counts: Array.isArray(dataProfile.object_counts) ? dataProfile.object_counts : [],
    counted_at: typeof dataProfile.counted_at === "string" ? dataProfile.counted_at : new Date().toISOString(),
  };
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
