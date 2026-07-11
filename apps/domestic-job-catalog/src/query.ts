import { createHash } from "node:crypto";
import type { AppConfig } from "./config";
import { buildCandidateEmbeddingText, type EmbeddingProvider } from "./embedding";
import { HttpError } from "./errors";
import { newId } from "./ids";
import { scoreJobMatch, vectorScoreFromOpenSearch } from "./matching/scoring";
import { catalogQueryRequestSchema, type CatalogQueryRequest } from "./schemas";
import type { JobSearchIndex } from "./search/opensearch";
import type { JobRepository, JobRow } from "./storage/postgres";

export class QueryService {
  constructor(
    private readonly config: AppConfig,
    private readonly jobs: JobRepository,
    private readonly search: JobSearchIndex,
    private readonly embeddings: EmbeddingProvider,
  ) {}

  async query(input: unknown) {
    const request = catalogQueryRequestSchema.parse(input);
    if (request.catalog_id && request.catalog_id !== this.config.catalogId) {
      throw new HttpError("validation_error", `catalog_id must be ${this.config.catalogId}`, 400);
    }
    const plan = this.plan(request);
    const entries = await this.execute(request, plan);
    await this.jobs.audit({
      catalogId: this.config.catalogId,
      queryPack: plan.queryPack,
      queryMode: plan.queryMode,
      requestHash: hash(input),
      resultCount: entries.length,
    });
    return {
      ocp_version: "1.0",
      kind: "CatalogQueryResult",
      id: newId("qres"),
      catalog_id: this.config.catalogId,
      query_pack: plan.queryPack,
      query_mode: plan.queryMode,
      query: request.query,
      result_count: entries.length,
      page: {
        limit: request.limit,
        offset: 0,
        has_more: false,
      },
      entries,
      policy_summary: {
        selected_capability_id: "ocp.job.domestic.matching.v1",
        selected_query_pack: plan.queryPack,
        query_mode: plan.queryMode,
        supports_explain: request.explain,
        accepted_filters: Object.keys(request.filters),
        rejected_filters: [],
        warnings: [],
      },
      audit_id: newId("qauditref"),
      explain: request.explain ? plan.explain : [],
    };
  }

  private plan(request: CatalogQueryRequest) {
    const queryPack = request.query_pack ?? inferPack(request);
    const queryMode = request.query_mode ?? inferMode(queryPack, request);
    const allowedModes = allowedModesForPack(queryPack);
    if (!allowedModes.includes(queryMode)) {
      throw new HttpError("invalid_query_mode", `query_mode ${queryMode} is not allowed for ${queryPack}`, 400, {
        allowed_modes: allowedModes,
      });
    }
    if (queryPack === "ocp.job.domestic.match_candidate.v1") {
      if (!request.candidate_profile) {
        throw new HttpError("candidate_profile_required", "candidate_profile is required for ocp.job.domestic.match_candidate.v1", 400);
      }
      if (!this.config.semanticEnabled) {
        throw new HttpError("semantic_disabled", "Candidate matching requires semantic search, but semantic search is disabled.", 503);
      }
      this.embeddings.assertEnabled();
      return {
        queryPack,
        queryMode,
        strategy: "match_candidate" as const,
        explain: ["Using hard filters, catalog-owned candidate embedding, OpenSearch vector recall, and structured rerank for computer jobs."],
      };
    }
    if ((queryMode === "semantic" || queryMode === "hybrid") && !this.config.semanticEnabled) {
      throw new HttpError("semantic_disabled", "Semantic search is disabled for this catalog.", 503);
    }
    if (queryPack === "ocp.job.domestic.filter.v1" || queryPack === "ocp.query.filter.v1") {
      if (request.candidate_profile) {
        throw new HttpError("candidate_profile_not_allowed", `${queryPack} does not accept candidate_profile; use ocp.job.domestic.match_candidate.v1.`, 400);
      }
      return {
        queryPack,
        queryMode,
        strategy: "filter" as const,
        explain: ["Using filter-only policy. No embedding or technical rerank is executed."],
      };
    }
    if (queryPack === "ocp.query.keyword.v1") {
      if (!request.query.trim()) throw new HttpError("query_required", "query is required for keyword search.", 400);
      return {
        queryPack,
        queryMode,
        strategy: "keyword" as const,
        explain: ["Using OpenSearch keyword retrieval. No candidate-profile rerank is executed."],
      };
    }
    if (queryPack === "ocp.query.semantic.v1") {
      if (!request.query.trim()) throw new HttpError("query_required", "query is required for semantic search.", 400);
      this.embeddings.assertEnabled();
      return {
        queryPack,
        queryMode,
        strategy: "semantic" as const,
        explain: ["Using catalog-owned query embedding and OpenSearch vector retrieval."],
      };
    }
    throw new HttpError("invalid_query_pack", `Unsupported query_pack ${queryPack}`, 400);
  }

  private async execute(
    request: CatalogQueryRequest,
    plan: ReturnType<QueryService["plan"]>,
  ) {
    const limit = Math.min(request.limit, this.config.maxQueryLimit);
    if (plan.strategy === "filter") {
      const rows = await this.jobs.filterJobs(request.filters, { limit });
      return rows.map((row, index) => buildMatch(row, 1 - index * 0.0001, request.explain, { status: "filtered" }));
    }
    if (plan.strategy === "keyword") {
      const hits = await this.search.keywordSearch({
        catalogId: this.config.catalogId,
        query: request.query,
        filters: request.filters,
        limit,
      });
      const rows = await this.jobs.getByIds(hits.map((hit) => hit.id));
      const scoreById = new Map(hits.map((hit) => [hit.id, hit.score]));
      return rows.map((row) => buildMatch(row, scoreById.get(row.id) ?? 0, request.explain, { status: "keyword" }));
    }
    if (plan.strategy === "semantic") {
      const embedded = await this.embeddings.embed(request.query);
      const hits = await this.search.semanticSearch({
        catalogId: this.config.catalogId,
        vector: embedded.vector,
        filters: request.filters,
        limit,
      });
      const rows = await this.jobs.getByIds(hits.map((hit) => hit.id));
      const scoreById = new Map(hits.map((hit) => [hit.id, vectorScoreFromOpenSearch(hit.score)]));
      return rows.map((row) => buildMatch(row, scoreById.get(row.id) ?? 0, request.explain, { status: "semantic" }));
    }
    const profile = request.candidate_profile;
    if (!profile) throw new HttpError("candidate_profile_required", "candidate_profile is required.", 400);
    const text = buildCandidateEmbeddingText(profile);
    const embedded = await this.embeddings.embed(text);
    const recallLimit = Math.max(limit, Math.min(this.config.defaultRecallLimit, this.config.defaultRecallLimit));
    const hits = await this.search.semanticSearch({
      catalogId: this.config.catalogId,
      vector: embedded.vector,
      filters: { ...request.filters, matching_mode: "computer" },
      limit: recallLimit,
    });
    const rows = await this.jobs.getByIds(hits.map((hit) => hit.id));
    const vectorById = new Map(hits.map((hit) => [hit.id, vectorScoreFromOpenSearch(hit.score)]));
    const ranked = rows.map((row) => {
      const breakdown = scoreJobMatch(row, profile, vectorById.get(row.id) ?? 0);
      return {
        row,
        score: breakdown.total,
        breakdown,
      };
    }).sort((left, right) => right.score - left.score || left.row.id.localeCompare(right.row.id));
    return ranked.slice(0, limit).map((item) => buildMatch(item.row, item.score, request.explain, {
      status: "reranked",
      breakdown: item.breakdown,
    }));
  }
}

function buildMatch(
  row: JobRow,
  score: number,
  explainEnabled: boolean,
  meta: { status: string; breakdown?: Record<string, unknown> },
) {
  return {
    entry: {
      kind: "CatalogEntry",
      catalog_id: row.catalog_id,
      entry_id: row.id,
      provider_id: row.provider_id,
      object_id: row.external_job_id,
      object_type: "domestic_job",
      commercial_object_id: row.id,
      title: row.title,
      summary: row.description.slice(0, 300),
      attributes: visibleAttributes(row),
    },
    score: Number(score.toFixed(4)),
    explain: explainEnabled
      ? [
        `status=${meta.status}`,
        ...(meta.breakdown ? [`score_breakdown=${JSON.stringify(meta.breakdown)}`] : []),
      ]
      : [],
  };
}

function visibleAttributes(row: JobRow) {
  return {
    title: row.title,
    company: row.company,
    city: row.city,
    province: row.province,
    district: row.district,
    recruitment_type: row.recruitment_type,
    matching_mode: row.matching_mode,
    job_family: row.job_family,
    job_type: row.job_type,
    salary_min: row.salary_min,
    salary_max: row.salary_max,
    currency: row.currency,
    min_total_years: row.min_total_years,
    skills: row.skills,
    tags: row.tags,
    source_platform: row.source_platform,
  };
}

function inferPack(request: CatalogQueryRequest) {
  if (request.candidate_profile) return "ocp.job.domestic.match_candidate.v1" as const;
  if (request.query.trim()) return "ocp.query.keyword.v1" as const;
  return "ocp.job.domestic.filter.v1" as const;
}

function inferMode(queryPack: string, request: CatalogQueryRequest) {
  if (queryPack === "ocp.job.domestic.match_candidate.v1") return "hybrid" as const;
  if (queryPack === "ocp.query.semantic.v1") return "semantic" as const;
  if (queryPack === "ocp.query.keyword.v1") return "keyword" as const;
  if (request.query.trim()) return "keyword" as const;
  return "filter" as const;
}

function allowedModesForPack(queryPack: string) {
  switch (queryPack) {
    case "ocp.job.domestic.match_candidate.v1":
      return ["semantic", "hybrid"];
    case "ocp.query.semantic.v1":
      return ["semantic", "hybrid"];
    case "ocp.query.keyword.v1":
      return ["keyword"];
    case "ocp.query.filter.v1":
    case "ocp.job.domestic.filter.v1":
      return ["filter"];
    default:
      throw new HttpError("invalid_query_pack", `Unsupported query_pack ${queryPack}`, 400);
  }
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
