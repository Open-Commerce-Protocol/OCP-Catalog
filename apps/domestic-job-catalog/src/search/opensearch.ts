import { Client } from "@opensearch-project/opensearch";
import type { AppConfig } from "../config";
import type { Filters } from "../schemas";
import type { JobRow } from "../storage/postgres";

export type SearchHit = {
  id: string;
  score: number;
};

export function createOpenSearchClient(config: AppConfig) {
  const options: ConstructorParameters<typeof Client>[0] = {
    node: config.openSearch.node,
    ssl: {
      rejectUnauthorized: true,
    },
  };
  if (config.openSearch.username && config.openSearch.password) {
    options.auth = {
      username: config.openSearch.username,
      password: config.openSearch.password,
    };
  }
  return new Client(options);
}

export class JobSearchIndex {
  constructor(
    private readonly client: Client,
    private readonly index: string,
    private readonly dimension: number,
  ) {}

  async ensureIndex() {
    const exists = await this.client.indices.exists({ index: this.index });
    if (exists.statusCode === 200) return;
    await this.client.indices.create({
      index: this.index,
      body: {
        settings: {
          index: {
            knn: true,
          },
        },
        mappings: {
          dynamic: "strict",
          properties: {
            id: { type: "keyword" },
            catalog_id: { type: "keyword" },
            provider_id: { type: "keyword" },
            title: { type: "text", fields: { raw: { type: "keyword" } } },
            company: { type: "text", fields: { raw: { type: "keyword" } } },
            description: { type: "text" },
            city: { type: "keyword" },
            province: { type: "keyword" },
            district: { type: "keyword" },
            recruitment_type: { type: "keyword" },
            matching_mode: { type: "keyword" },
            job_family: { type: "keyword" },
            job_type: { type: "keyword" },
            remote_type: { type: "keyword" },
            salary_min: { type: "integer" },
            salary_max: { type: "integer" },
            min_total_years: { type: "integer" },
            search_text: { type: "text" },
            embedding_vector: {
              type: "knn_vector",
              dimension: this.dimension,
              method: {
                name: "hnsw",
                space_type: "cosinesimil",
                engine: "lucene",
              },
            },
            updated_at: { type: "date" },
          },
        },
      },
    });
  }

  async indexJob(row: JobRow, vector?: number[]) {
    if (vector && vector.length !== this.dimension) {
      throw new Error(`OpenSearch vector dimension mismatch: ${vector.length} vs ${this.dimension}`);
    }
    const document: Record<string, unknown> = {
      id: row.id,
      catalog_id: row.catalog_id,
      provider_id: row.provider_id,
      title: row.title,
      company: row.company,
      description: row.description,
      city: row.city,
      province: row.province,
      district: row.district,
      recruitment_type: row.recruitment_type,
      matching_mode: row.matching_mode,
      job_family: row.job_family,
      job_type: row.job_type,
      remote_type: row.remote_type,
      salary_min: row.salary_min,
      salary_max: row.salary_max,
      min_total_years: row.min_total_years,
      search_text: [
        row.title,
        row.company,
        row.city,
        row.job_family,
        row.description,
        ...row.skills.map((item) => item.name).filter((value): value is string => typeof value === "string"),
        ...row.tags.map((item) => item.name).filter((value): value is string => typeof value === "string"),
      ].join(" "),
      updated_at: row.updated_at.toISOString(),
    };
    if (vector) document.embedding_vector = vector;
    await this.client.index({
      index: this.index,
      id: row.id,
      refresh: false,
      body: document,
    });
  }

  async semanticSearch(input: {
    catalogId: string;
    vector: number[];
    filters: Filters;
    limit: number;
  }): Promise<SearchHit[]> {
    const response = await this.client.search({
      index: this.index,
      body: {
        size: input.limit,
        query: {
          bool: {
            filter: [
              { term: { catalog_id: input.catalogId } },
              { term: { matching_mode: "computer" } },
              ...filterClauses(input.filters),
            ],
            must: [
              {
                knn: {
                  embedding_vector: {
                    vector: input.vector,
                    k: input.limit,
                  },
                },
              },
            ],
          },
        },
      },
    });
    return hits(response.body);
  }

  async keywordSearch(input: {
    catalogId: string;
    query: string;
    filters: Filters;
    limit: number;
  }): Promise<SearchHit[]> {
    const response = await this.client.search({
      index: this.index,
      body: {
        size: input.limit,
        query: {
          bool: {
            filter: [
              { term: { catalog_id: input.catalogId } },
              ...filterClauses(input.filters),
            ],
            must: [
              {
                multi_match: {
                  query: input.query,
                  fields: ["title^4", "company^2", "search_text", "description"],
                },
              },
            ],
          },
        },
      },
    });
    return hits(response.body);
  }

  async health() {
    return this.client.cluster.health();
  }
}

function filterClauses(filters: Filters) {
  const clauses: Array<Record<string, unknown>> = [];
  if (filters.provider_id) clauses.push({ term: { provider_id: filters.provider_id } });
  if (filters.province) clauses.push({ term: { province: filters.province } });
  if (filters.city) clauses.push({ term: { city: filters.city } });
  if (filters.cities?.length) clauses.push({ terms: { city: filters.cities } });
  if (filters.district) clauses.push({ term: { district: filters.district } });
  if (filters.recruitment_type) clauses.push({ term: { recruitment_type: filters.recruitment_type } });
  if (filters.matching_mode) clauses.push({ term: { matching_mode: filters.matching_mode } });
  if (filters.job_family) clauses.push({ term: { job_family: filters.job_family } });
  if (filters.job_type) clauses.push({ term: { job_type: filters.job_type } });
  if (filters.remote_type) clauses.push({ term: { remote_type: filters.remote_type } });
  if (filters.salary_min !== undefined) clauses.push({ range: { salary_max: { gte: filters.salary_min } } });
  if (filters.salary_max !== undefined) clauses.push({ range: { salary_min: { lte: filters.salary_max } } });
  if (filters.max_required_years !== undefined) clauses.push({ range: { min_total_years: { lte: filters.max_required_years } } });
  return clauses;
}

function hits(body: unknown): SearchHit[] {
  const raw = body as { hits?: { hits?: Array<{ _id?: string; _score?: number }> } };
  return (raw.hits?.hits ?? [])
    .map((hit) => ({ id: hit._id ?? "", score: hit._score ?? 0 }))
    .filter((hit) => hit.id);
}
