import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import type { AppConfig } from "../config";
import { HttpError } from "../errors";
import type { DomesticJobInput, Filters } from "../schemas";

const { Pool } = pg;

export type JobRow = {
  id: string;
  catalog_id: string;
  provider_id: string;
  external_job_id: string;
  title: string;
  company: string;
  description: string;
  apply_url: string;
  source_platform: string;
  source_url: string | null;
  job_status: "active";
  fetched_at: Date;
  updated_at: Date;
  province: string | null;
  city: string;
  district: string | null;
  address: string | null;
  remote_type: string | null;
  recruitment_type: "campus" | "social" | "internship";
  matching_mode: "computer" | "filter_only";
  classification_status: "classified" | "review_required" | "unclassified";
  classification_confidence: string | null;
  job_type: string | null;
  job_family: string;
  industry_code: string | null;
  industry_category_code: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_months_min: number | null;
  salary_months_max: number | null;
  currency: string;
  min_total_years: number | null;
  max_total_years: number | null;
  education: Record<string, unknown>;
  skills: Array<Record<string, unknown>>;
  experiences: Array<Record<string, unknown>>;
  tags: Array<Record<string, unknown>>;
  responsibilities: string[];
  highlights: string[];
  evidence: string[];
  schema_version: string;
  raw_payload: Record<string, unknown>;
  source_hash: string;
  embedding_text: string | null;
  embedding_model: string | null;
  embedding_dimension: number | null;
  embedding_status: "pending" | "ready" | "failed";
  indexed_at: Date | null;
};

export type QueryAuditInput = {
  catalogId: string;
  queryPack: string;
  queryMode: string;
  requestHash: string;
  resultCount: number;
  errorCode?: string;
};

export function createPool(config: AppConfig) {
  return new Pool({
    connectionString: normalizeDatabaseUrl(config.databaseUrl, config.dbSsl),
    ssl: config.dbSsl ? { rejectUnauthorized: false } : undefined,
    max: 20,
  });
}

function normalizeDatabaseUrl(value: string, dbSsl: boolean) {
  if (!dbSsl) return value;
  const url = new URL(value);
  url.searchParams.delete("sslmode");
  return url.toString();
}

export class JobRepository {
  constructor(
    private readonly pool: pg.Pool,
    private readonly catalogId: string,
  ) {}

  async ensureSchema() {
    await this.pool.query(`
      create table if not exists domestic_job_entries (
        id text primary key,
        catalog_id text not null,
        provider_id text not null,
        external_job_id text not null,
        title text not null,
        company text not null,
        description text not null,
        apply_url text not null,
        source_platform text not null,
        source_url text,
        job_status text not null check (job_status = 'active'),
        fetched_at timestamptz not null,
        updated_at timestamptz not null default now(),
        province text,
        city text not null,
        district text,
        address text,
        remote_type text,
        recruitment_type text not null check (recruitment_type in ('campus','social','internship')),
        matching_mode text not null check (matching_mode in ('computer','filter_only')),
        classification_status text not null check (classification_status in ('classified','review_required','unclassified')),
        classification_confidence text,
        job_type text,
        job_family text not null,
        industry_code text,
        industry_category_code text,
        salary_min integer,
        salary_max integer,
        salary_months_min integer,
        salary_months_max integer,
        currency text not null default 'CNY',
        min_total_years integer,
        max_total_years integer,
        education jsonb not null default '{}'::jsonb,
        skills jsonb not null default '[]'::jsonb,
        experiences jsonb not null default '[]'::jsonb,
        tags jsonb not null default '[]'::jsonb,
        responsibilities jsonb not null default '[]'::jsonb,
        highlights jsonb not null default '[]'::jsonb,
        evidence jsonb not null default '[]'::jsonb,
        schema_version text not null,
        raw_payload jsonb not null default '{}'::jsonb,
        source_hash text not null,
        embedding_text text,
        embedding_model text,
        embedding_dimension integer,
        embedding_status text not null default 'pending' check (embedding_status in ('pending','ready','failed')),
        embedding_error text,
        indexed_at timestamptz,
        created_at timestamptz not null default now(),
        updated_row_at timestamptz not null default now(),
        unique (catalog_id, provider_id, external_job_id)
      );

      create index if not exists domestic_job_entries_active_idx
        on domestic_job_entries (catalog_id, job_status, classification_status, matching_mode, city, recruitment_type);
      create index if not exists domestic_job_entries_family_idx
        on domestic_job_entries (catalog_id, job_family);
      create index if not exists domestic_job_entries_provider_idx
        on domestic_job_entries (catalog_id, provider_id);
      create index if not exists domestic_job_entries_updated_idx
        on domestic_job_entries (catalog_id, updated_at desc, id);

      create table if not exists domestic_job_query_audits (
        id text primary key,
        catalog_id text not null,
        query_pack text not null,
        query_mode text not null,
        request_hash text not null,
        result_count integer not null,
        error_code text,
        created_at timestamptz not null default now()
      );
      create index if not exists domestic_job_query_audits_catalog_created_idx
        on domestic_job_query_audits (catalog_id, created_at desc);
    `);
  }

  async upsertJob(job: DomesticJobInput, embeddingText: string) {
    const sourceHash = hashJson(job);
    const id = `job_${createHash("sha256").update(`${this.catalogId}:${job.provider_id}:${job.external_job_id}`).digest("hex").slice(0, 32)}`;
    const result = await this.pool.query<JobRow>(
      `
      insert into domestic_job_entries (
        id, catalog_id, provider_id, external_job_id, title, company, description, apply_url,
        source_platform, source_url, job_status, fetched_at, updated_at, province, city, district,
        address, remote_type, recruitment_type, matching_mode, classification_status,
        classification_confidence, job_type, job_family, industry_code, industry_category_code,
        salary_min, salary_max, salary_months_min, salary_months_max, currency,
        min_total_years, max_total_years, education, skills, experiences, tags,
        responsibilities, highlights, evidence, schema_version, raw_payload, source_hash,
        embedding_text, embedding_status, indexed_at, updated_row_at
      )
      values (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,coalesce($13::timestamptz, now()),$14,$15,$16,
        $17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,
        $34::jsonb,$35::jsonb,$36::jsonb,$37::jsonb,$38::jsonb,$39::jsonb,$40::jsonb,
        $41,$42::jsonb,$43,$44,'pending',null,now()
      )
      on conflict (catalog_id, provider_id, external_job_id) do update set
        title = excluded.title,
        company = excluded.company,
        description = excluded.description,
        apply_url = excluded.apply_url,
        source_platform = excluded.source_platform,
        source_url = excluded.source_url,
        job_status = excluded.job_status,
        fetched_at = excluded.fetched_at,
        updated_at = excluded.updated_at,
        province = excluded.province,
        city = excluded.city,
        district = excluded.district,
        address = excluded.address,
        remote_type = excluded.remote_type,
        recruitment_type = excluded.recruitment_type,
        matching_mode = excluded.matching_mode,
        classification_status = excluded.classification_status,
        classification_confidence = excluded.classification_confidence,
        job_type = excluded.job_type,
        job_family = excluded.job_family,
        industry_code = excluded.industry_code,
        industry_category_code = excluded.industry_category_code,
        salary_min = excluded.salary_min,
        salary_max = excluded.salary_max,
        salary_months_min = excluded.salary_months_min,
        salary_months_max = excluded.salary_months_max,
        currency = excluded.currency,
        min_total_years = excluded.min_total_years,
        max_total_years = excluded.max_total_years,
        education = excluded.education,
        skills = excluded.skills,
        experiences = excluded.experiences,
        tags = excluded.tags,
        responsibilities = excluded.responsibilities,
        highlights = excluded.highlights,
        evidence = excluded.evidence,
        schema_version = excluded.schema_version,
        raw_payload = excluded.raw_payload,
        source_hash = excluded.source_hash,
        embedding_text = excluded.embedding_text,
        embedding_status = case
          when domestic_job_entries.embedding_text is distinct from excluded.embedding_text then 'pending'
          else domestic_job_entries.embedding_status
        end,
        indexed_at = case
          when domestic_job_entries.source_hash is distinct from excluded.source_hash then null
          else domestic_job_entries.indexed_at
        end,
        updated_row_at = now()
      returning *
      `,
      [
        id,
        this.catalogId,
        job.provider_id,
        job.external_job_id,
        job.title,
        job.company,
        job.description,
        job.apply_url,
        job.source_platform,
        job.source_url ?? null,
        job.job_status,
        job.fetched_at,
        job.updated_at ?? null,
        job.province ?? null,
        job.city,
        job.district ?? null,
        job.address ?? null,
        job.remote_type ?? null,
        job.recruitment_type,
        job.matching_mode,
        job.classification_status,
        job.classification_confidence ?? null,
        job.job_type ?? null,
        job.job_family,
        job.industry_code ?? null,
        job.industry_category_code ?? null,
        job.salary_min ?? null,
        job.salary_max ?? null,
        job.salary_months_min ?? null,
        job.salary_months_max ?? null,
        job.currency,
        job.min_total_years ?? null,
        job.max_total_years ?? null,
        JSON.stringify(job.education),
        JSON.stringify(job.skills),
        JSON.stringify(job.experiences),
        JSON.stringify(job.tags),
        JSON.stringify(job.responsibilities),
        JSON.stringify(job.highlights),
        JSON.stringify(job.evidence),
        job.schema_version,
        JSON.stringify(job.raw_payload),
        sourceHash,
        embeddingText,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new HttpError("db_write_failed", "Job upsert did not return a row", 500);
    return row;
  }

  async markEmbeddingReady(id: string, model: string, dimension: number) {
    await this.pool.query(
      `update domestic_job_entries
       set embedding_model=$2, embedding_dimension=$3, embedding_status='ready', embedding_error=null, updated_row_at=now()
       where id=$1 and catalog_id=$4`,
      [id, model, dimension, this.catalogId],
    );
  }

  async markEmbeddingFailed(id: string, error: string) {
    await this.pool.query(
      `update domestic_job_entries
       set embedding_status='failed', embedding_error=$2, updated_row_at=now()
       where id=$1 and catalog_id=$3`,
      [id, error.slice(0, 4000), this.catalogId],
    );
  }

  async markIndexed(id: string) {
    await this.pool.query(
      `update domestic_job_entries set indexed_at=now(), updated_row_at=now() where id=$1 and catalog_id=$2`,
      [id, this.catalogId],
    );
  }

  async getById(id: string) {
    const result = await this.pool.query<JobRow>(
      `select * from domestic_job_entries where catalog_id=$1 and id=$2 and job_status='active' and classification_status='classified'`,
      [this.catalogId, id],
    );
    return result.rows[0] ?? null;
  }

  async getByIds(ids: string[]) {
    if (ids.length === 0) return [];
    const result = await this.pool.query<JobRow>(
      `select * from domestic_job_entries where catalog_id=$1 and id = any($2::text[])`,
      [this.catalogId, ids],
    );
    const byId = new Map(result.rows.map((row) => [row.id, row]));
    return ids.map((id) => byId.get(id)).filter((row): row is JobRow => Boolean(row));
  }

  async filterJobs(filters: Filters, options: { limit: number }) {
    const { sql, values } = buildFilterWhere(this.catalogId, filters);
    const result = await this.pool.query<JobRow>(
      `select * from domestic_job_entries ${sql} order by updated_at desc, id asc limit $${values.length + 1}`,
      [...values, options.limit],
    );
    return result.rows;
  }

  async dataProfile() {
    const result = await this.pool.query<{
      total: string;
      computer: string;
      filter_only: string;
      ready: string;
    }>(
      `select
        count(*)::text total,
        count(*) filter (where matching_mode='computer')::text computer,
        count(*) filter (where matching_mode='filter_only')::text filter_only,
        count(*) filter (where embedding_status='ready')::text ready
       from domestic_job_entries
       where catalog_id=$1 and job_status='active' and classification_status='classified'`,
      [this.catalogId],
    );
    const row = result.rows[0];
    return {
      catalog_entry_count: Number(row?.total ?? 0),
      object_counts: [{ object_type: "domestic_job", count: Number(row?.total ?? 0) }],
      matching_modes: {
        computer: Number(row?.computer ?? 0),
        filter_only: Number(row?.filter_only ?? 0),
      },
      embedding_ready_count: Number(row?.ready ?? 0),
      counted_at: new Date().toISOString(),
    };
  }

  async audit(input: QueryAuditInput) {
    await this.pool.query(
      `insert into domestic_job_query_audits
       (id, catalog_id, query_pack, query_mode, request_hash, result_count, error_code)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        `qaudit_${randomUUID().replaceAll("-", "")}`,
        input.catalogId,
        input.queryPack,
        input.queryMode,
        input.requestHash,
        input.resultCount,
        input.errorCode ?? null,
      ],
    );
  }
}

export function buildFilterWhere(catalogId: string, filters: Filters, options: { forceComputerReady?: boolean } = {}) {
  const parts = [
    "catalog_id=$1",
    "job_status='active'",
    "classification_status='classified'",
  ];
  const values: unknown[] = [catalogId];
  const push = (fragment: string, value: unknown) => {
    values.push(value);
    parts.push(fragment.replace("?", `$${values.length}`));
  };
  if (filters.provider_id) push("provider_id=?", filters.provider_id);
  if (filters.province) push("province=?", filters.province);
  if (filters.city) push("city=?", filters.city);
  if (filters.cities?.length) {
    values.push(filters.cities);
    parts.push(`city = any($${values.length}::text[])`);
  }
  if (filters.district) push("district=?", filters.district);
  if (filters.recruitment_type) push("recruitment_type=?", filters.recruitment_type);
  if (filters.matching_mode) push("matching_mode=?", filters.matching_mode);
  if (filters.job_family) push("job_family=?", filters.job_family);
  if (filters.job_type) push("job_type=?", filters.job_type);
  if (filters.remote_type) push("remote_type=?", filters.remote_type);
  if (filters.salary_min !== undefined) push("(salary_max is null or salary_max >= ?)", filters.salary_min);
  if (filters.salary_max !== undefined) push("(salary_min is null or salary_min <= ?)", filters.salary_max);
  if (filters.min_required_years !== undefined) push("(min_total_years is null or min_total_years >= ?)", filters.min_required_years);
  if (filters.max_required_years !== undefined) push("(min_total_years is null or min_total_years <= ?)", filters.max_required_years);
  if (filters.tag) {
    values.push(filters.tag);
    parts.push(`exists (select 1 from jsonb_array_elements(tags) tag where lower(tag->>'name') = lower($${values.length}::text))`);
  }
  if (options.forceComputerReady) {
    parts.push("matching_mode='computer'");
    parts.push("embedding_status='ready'");
  }
  return {
    sql: `where ${parts.join(" and ")}`,
    values,
  };
}

function hashJson(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
