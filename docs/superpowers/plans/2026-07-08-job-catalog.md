# Job Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a first-class OCP Job Catalog from JobSpy/Indeed CSV data without forcing it through the existing commerce product abstraction.

**Architecture:** Implement Job Catalog as an independent catalog app instance that reuses the shared OCP catalog core, object sync ledger, outbox, search document pipeline, embedding workers, and vector retrieval infrastructure. Add job-specific descriptor/query schemas and a job scenario module, then import CSV rows as `CommercialObject` records through the existing provider registration and NDJSON object sync protocol instead of writing database tables directly.

**Tech Stack:** Bun, TypeScript, Elysia, Drizzle/PostgreSQL, pgvector/OpenSearch adapters, existing `@ocp-catalog/catalog-core`, `@ocp-catalog/catalog-db`, `@ocp-catalog/ocp-schema`, Terminus for remote data inspection.

---

## Context

Remote data source:

- Server alias: `deeplumen-crawler`
- Data path: `/home/deeplumen/jobspy-service/data`
- Current files: 14 CSV files, about 16GB total
- Largest file: `indeed_master.csv`, about 13.5GB
- Representative columns:
  - `id`
  - `site`
  - `job_url`
  - `job_url_direct`
  - `title`
  - `company`
  - `location`
  - `date_posted`
  - `job_type`
  - `salary_source`
  - `interval`
  - `min_amount`
  - `max_amount`
  - `currency`
  - `is_remote`
  - `job_level`
  - `job_function`
  - `listing_type`
  - `emails`
  - `description`
  - `company_industry`
  - `company_url`
  - `company_logo`
  - `company_url_direct`
  - `company_addresses`
  - `company_num_employees`
  - `company_revenue`
  - `company_description`
  - `skills`
  - `experience_range`
  - `company_rating`
  - `company_reviews_count`
  - `vacancy_count`
  - `work_from_home_type`

Important existing implementation facts:

- `apps/commerce-catalog-api/src/commerce-scenario.ts` already proves `CatalogScenarioModule` is the right extension point for domain-specific object contracts, descriptor validation, search projection, embedding text, resolve actions, and live checks.
- `packages/catalog-core/src/object-sync-service.ts` already implements fail-loud object validation, provider contract checks, batch idempotency, stream run checkpointing, bulk writes, and side-effect intents for search indexing.
- `apps/commerce-catalog-api/src/search/**` already contains the high-throughput search pipeline: search document upsert, embedding work items, batch embedding backfill, queue cleanup, pgvector/OpenSearch retrieval, and text search adapter support.
- Current `packages/ocp-schema/src/index.ts` has commerce-shaped `catalogQueryFiltersSchema`; Job Catalog should not permanently add more commerce-specific fields to this generic query schema without a boundary decision.

## Architecture Decisions

1. **Create a real Job Catalog instance.**
   Do not rename or overload the commerce catalog. The new app should use `CATALOG_ID=cat_ocp_jobs_*`, `object_type=job`, and its own manifest/query capability.

2. **Reuse core ingestion and indexing, not commerce semantics.**
   Reuse object sync stream, outbox, search document queue, embedding workers, vector adapters, and registration flow. Do not reuse commerce product fields like `brand`, `amount`, or `availability_status` as fake job concepts.

3. **Introduce Job descriptor packs.**
   Add at least:
   - `ocp.job.posting.v1`
   - `ocp.organization.employer.v1`
   - optional `ocp.compensation.v1`

4. **Keep required fields minimal and honest.**
   Required fields should be:
   - `ocp.job.posting.v1#/title`
   - `ocp.job.posting.v1#/company`
   - `ocp.job.posting.v1#/location`
   - one of `ocp.job.posting.v1#/job_url` or `ocp.job.posting.v1#/job_url_direct`

   Salary, remote, job type, skills, and company fields must be optional because sampled CSV rows show many blanks.

5. **Import through OCP sync only.**
   The CSV importer must register a provider and push NDJSON to `/ocp/objects/sync/stream`. It must not insert into `commercial_objects`, `catalog_entries`, or search tables directly.

6. **Fail loud on invalid rows and invalid batches.**
   Invalid CSV rows should become explicit rejected sync items or importer errors. Do not silently substitute default title/company/location, fake salary, fake URL, or empty successful objects.

7. **Prefer root-cause schema changes over ad hoc adapters.**
   If generic query schema blocks job filters, introduce a scenario-aware query request boundary rather than stuffing job filters into commerce-specific schema fields.

## Proposed File Structure

Create:

- `ocp.catalog.handshake.v1/pack.ocp.job.posting.v1.schema.json`
  JSON Schema descriptor pack for job posting fields.

- `ocp.catalog.handshake.v1/pack.ocp.organization.employer.v1.schema.json`
  JSON Schema descriptor pack for employer/company fields.

- `ocp.catalog.handshake.v1/pack.ocp.compensation.v1.schema.json`
  JSON Schema descriptor pack for compensation range fields.

- `apps/job-catalog-api/package.json`
  Independent app package, based on commerce catalog runtime dependencies.

- `apps/job-catalog-api/src/job-scenario.ts`
  Job-specific `CatalogScenarioModule`.

- `apps/job-catalog-api/src/job-scenario.test.ts`
  Unit tests for descriptor validation, projection, embedding text, and resolve actions.

- `apps/job-catalog-api/src/query/job-query-schema.ts`
  Job-specific query request parser and filters.

- `apps/job-catalog-api/src/query/job-query-planner.ts`
  Manifest-aware query mode/pack selection for jobs.

- `apps/job-catalog-api/src/query/job-query-service.ts`
  Job query service reusing search document tables and semantic retrieval.

- `apps/job-catalog-api/src/runtime/context.ts`
  Job runtime context wiring shared DB/search/embedding services.

- `apps/job-catalog-api/src/http/app.ts`
  Elysia app composition.

- `apps/job-catalog-api/src/http/routes/protocol.ts`
  Job protocol routes.

- `apps/job-catalog-api/src/index.ts`
  API entrypoint.

- `apps/job-catalog-api/src/worker.ts`
  Worker entrypoint for indexing/embedding/outbox.

- `apps/job-catalog-api/src/scripts/jobspy-csv-to-ndjson.ts`
  Streaming CSV-to-CommercialObject converter.

- `apps/job-catalog-api/src/scripts/import-jobspy-csv.ts`
  Provider registration plus NDJSON stream upload script.

- `apps/job-catalog-api/src/scripts/jobspy-csv-to-ndjson.test.ts`
  Row mapping and validation tests.

Modify:

- `packages/ocp-schema/src/index.ts`
  Add Zod schemas and exported types for new descriptor packs. Avoid making the generic `catalogQueryFiltersSchema` more commerce-shaped.

- `ocp.catalog.handshake.v1/package.json`
  Include new schema files if package exports or schema validation expects an explicit file list.

- `package.json`
  Add scripts such as `job:catalog:api`, `job:catalog:worker`, and job importer helpers.

- `README.md`
  Add Job Catalog as a separate app and describe its data/source boundary.

- `.env.example`
  Add `JOB_CATALOG_*` or document that job app uses the same generic `CATALOG_*` variables in a separate process environment.

Optional later:

- Split `apps/commerce-catalog-api/src/search/**` into a shared package such as `packages/catalog-search-runtime`.
  Do this only if importing those modules from `apps/job-catalog-api` creates awkward cross-app dependencies.

## Task 1: Add Job Descriptor Pack Schemas

**Files:**

- Create: `ocp.catalog.handshake.v1/pack.ocp.job.posting.v1.schema.json`
- Create: `ocp.catalog.handshake.v1/pack.ocp.organization.employer.v1.schema.json`
- Create: `ocp.catalog.handshake.v1/pack.ocp.compensation.v1.schema.json`
- Modify: `packages/ocp-schema/src/index.ts`
- Test: `packages/ocp-schema/src/job-packs.test.ts`

- [ ] **Step 1: Write descriptor pack tests**

Create `packages/ocp-schema/src/job-packs.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import {
  compensationPackSchema,
  employerPackSchema,
  jobPostingPackSchema,
} from './index';

describe('job descriptor packs', () => {
  it('accepts a minimal job posting with a source URL', () => {
    expect(jobPostingPackSchema.parse({
      title: 'AI Tooling Engineer',
      company: 'Qventus',
      location: 'San Francisco, CA, US',
      date_posted: '2026-07-08',
      site: 'indeed',
      job_url: 'https://www.indeed.com/viewjob?jk=6dc4256339df9c77',
      is_remote: false,
    })).toEqual({
      title: 'AI Tooling Engineer',
      company: 'Qventus',
      location: 'San Francisco, CA, US',
      date_posted: '2026-07-08',
      site: 'indeed',
      job_url: 'https://www.indeed.com/viewjob?jk=6dc4256339df9c77',
      is_remote: false,
    });
  });

  it('rejects a job posting without any source URL', () => {
    const result = jobPostingPackSchema.safeParse({
      title: 'AI Tooling Engineer',
      company: 'Qventus',
      location: 'San Francisco, CA, US',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message).join('\n')).toContain('job_url or job_url_direct is required');
    }
  });

  it('accepts sparse employer data from JobSpy rows', () => {
    expect(employerPackSchema.parse({
      company: 'Walmart',
      company_url: 'https://www.indeed.com/cmp/Walmart',
      company_url_direct: 'https://careers.walmart.com',
      company_logo: 'https://d2q79iu7y748jz.cloudfront.net/s/_squarelogo/256x256/9c80885fef258045d6217203814f0e34',
      company_num_employees: '10,000+',
      company_revenue: 'more than $10B (USD)',
    }).company).toBe('Walmart');
  });

  it('accepts salary ranges when present and allows omitted compensation', () => {
    expect(compensationPackSchema.parse({
      salary_source: 'direct_data',
      interval: 'yearly',
      min_amount: 120000,
      max_amount: 150000,
      currency: 'USD',
    }).currency).toBe('USD');
    expect(compensationPackSchema.parse({})).toEqual({});
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```powershell
bun test packages/ocp-schema/src/job-packs.test.ts
```

Expected: FAIL because `jobPostingPackSchema`, `employerPackSchema`, and `compensationPackSchema` are not exported.

- [ ] **Step 3: Add Zod schemas**

Modify `packages/ocp-schema/src/index.ts` with:

```ts
export const jobPostingPackSchema = z.object({
  title: z.string().min(1),
  company: z.string().min(1),
  location: z.string().min(1),
  site: z.string().min(1).optional(),
  job_url: z.string().url().optional(),
  job_url_direct: z.string().url().optional(),
  date_posted: z.string().min(1).optional(),
  job_type: z.string().min(1).optional(),
  is_remote: z.boolean().optional(),
  job_level: z.string().min(1).optional(),
  job_function: z.string().min(1).optional(),
  listing_type: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  skills: z.array(z.string().min(1)).optional(),
  experience_range: z.string().min(1).optional(),
  work_from_home_type: z.string().min(1).optional(),
}).strict().superRefine((value, ctx) => {
  if (!value.job_url && !value.job_url_direct) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['job_url'],
      message: 'job_url or job_url_direct is required',
    });
  }
});

export const employerPackSchema = z.object({
  company: z.string().min(1),
  company_industry: z.string().min(1).optional(),
  company_url: z.string().url().optional(),
  company_logo: z.string().url().optional(),
  company_url_direct: z.string().url().optional(),
  company_addresses: z.string().min(1).optional(),
  company_num_employees: z.string().min(1).optional(),
  company_revenue: z.string().min(1).optional(),
  company_description: z.string().min(1).optional(),
  company_rating: z.number().optional(),
  company_reviews_count: z.number().int().min(0).optional(),
}).strict();

export const compensationPackSchema = z.object({
  salary_source: z.string().min(1).optional(),
  interval: z.enum(['hourly', 'daily', 'weekly', 'monthly', 'yearly']).optional(),
  min_amount: z.number().optional(),
  max_amount: z.number().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
}).strict().superRefine((value, ctx) => {
  if ((value.min_amount !== undefined || value.max_amount !== undefined) && !value.currency) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['currency'],
      message: 'currency is required when min_amount or max_amount is present',
    });
  }
});

export type JobPostingPack = z.infer<typeof jobPostingPackSchema>;
export type EmployerPack = z.infer<typeof employerPackSchema>;
export type CompensationPack = z.infer<typeof compensationPackSchema>;
```

- [ ] **Step 4: Add JSON Schema files**

Create the three JSON Schema files under `ocp.catalog.handshake.v1/`. Keep them aligned with the Zod schemas. The job posting JSON Schema must use `anyOf` to require at least one of `job_url` or `job_url_direct`.

- [ ] **Step 5: Run schema tests**

Run:

```powershell
bun test packages/ocp-schema/src/job-packs.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add packages/ocp-schema/src/index.ts packages/ocp-schema/src/job-packs.test.ts ocp.catalog.handshake.v1/pack.ocp.job.posting.v1.schema.json ocp.catalog.handshake.v1/pack.ocp.organization.employer.v1.schema.json ocp.catalog.handshake.v1/pack.ocp.compensation.v1.schema.json
git commit -m "feat: add OCP job descriptor packs"
```

## Task 2: Build the Job Scenario Module

**Files:**

- Create: `apps/job-catalog-api/package.json`
- Create: `apps/job-catalog-api/src/job-scenario.ts`
- Create: `apps/job-catalog-api/src/job-scenario.test.ts`

- [ ] **Step 1: Create app package**

Create `apps/job-catalog-api/package.json`:

```json
{
  "name": "@ocp-catalog/job-catalog-api",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "bun run src/index.ts",
    "worker": "bun run src/worker.ts",
    "test": "bun test src"
  },
  "dependencies": {
    "@ocp-catalog/activity-db": "workspace:*",
    "@ocp-catalog/catalog-core": "workspace:*",
    "@ocp-catalog/catalog-db": "workspace:*",
    "@ocp-catalog/config": "workspace:*",
    "@ocp-catalog/db": "workspace:*",
    "@ocp-catalog/ocp-activity-core": "workspace:*",
    "@ocp-catalog/ocp-schema": "workspace:*",
    "@ocp-catalog/shared": "workspace:*",
    "elysia": "^1.4.16",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "typescript": "^5.9.2"
  }
}
```

- [ ] **Step 2: Write scenario tests**

Create `apps/job-catalog-api/src/job-scenario.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { createJobCatalogScenario } from './job-scenario';

const scenario = createJobCatalogScenario({ semanticSearchEnabled: true });

describe('job catalog scenario', () => {
  it('publishes a job object contract without requiring salary', () => {
    const [contract] = scenario.objectContracts();
    expect(contract.required_fields).toContain('ocp.job.posting.v1#/title');
    expect(contract.required_fields).toContain('ocp.job.posting.v1#/company');
    expect(contract.required_fields).toContain('ocp.job.posting.v1#/location');
    expect(contract.required_fields).toContainEqual([
      'ocp.job.posting.v1#/job_url',
      'ocp.job.posting.v1#/job_url_direct',
    ]);
    expect(contract.optional_fields).toContain('ocp.compensation.v1#/min_amount');
  });

  it('projects a JobSpy row-shaped object into searchable job attributes', () => {
    const projection = scenario.buildSearchProjection({
      ocp_version: '1.0',
      kind: 'CommercialObject',
      id: 'indeed:in-6dc4256339df9c77',
      object_id: 'indeed:in-6dc4256339df9c77',
      object_type: 'job',
      provider_id: 'jobspy_indeed',
      title: 'AI Tooling Engineer',
      status: 'active',
      source_url: 'https://www.indeed.com/viewjob?jk=6dc4256339df9c77',
      descriptors: [
        {
          pack_id: 'ocp.job.posting.v1',
          data: {
            title: 'AI Tooling Engineer',
            company: 'Qventus',
            location: 'San Francisco, CA, US',
            site: 'indeed',
            job_url: 'https://www.indeed.com/viewjob?jk=6dc4256339df9c77',
            job_url_direct: 'https://grnh.se/rr0chfxi9us',
            date_posted: '2026-07-08',
            is_remote: false,
            description: 'Build AI tooling for healthcare operations.',
          },
        },
        {
          pack_id: 'ocp.compensation.v1',
          data: {
            salary_source: 'direct_data',
            interval: 'yearly',
            min_amount: 120000,
            max_amount: 150000,
            currency: 'USD',
          },
        },
      ],
    });

    expect(projection.title).toBe('AI Tooling Engineer');
    expect(projection.company).toBe('Qventus');
    expect(projection.location).toBe('San Francisco, CA, US');
    expect(projection.is_remote).toBe(false);
    expect(projection.currency).toBe('USD');
    expect(projection.min_amount).toBe(120000);
    expect(String(projection.text)).toContain('qventus');
  });

  it('creates view_job and view_company resolve actions when URLs exist', () => {
    const actions = scenario.buildResolveActions?.({
      request: { entry_id: 'entry_1', purpose: 'view', live_check: true, requested_fields: [] },
      projection: {
        job_url_direct: 'https://grnh.se/rr0chfxi9us',
        company_url_direct: 'https://www.qventus.com',
      },
      catalog_id: 'cat_ocp_jobs_dev',
      entry_id: 'entry_1',
      commercial_object_id: 'cobj_1',
      object_id: 'indeed:in-6dc4256339df9c77',
      object_type: 'job',
      provider_id: 'jobspy_indeed',
      title: 'AI Tooling Engineer',
      resolved_at: '2026-07-08T00:00:00.000Z',
      expires_at: '2026-07-09T00:00:00.000Z',
    });

    expect(actions?.map((action) => action.action_id)).toEqual(['view_job', 'view_company']);
  });
});
```

- [ ] **Step 3: Run failing tests**

Run:

```powershell
bun test apps/job-catalog-api/src/job-scenario.test.ts
```

Expected: FAIL because `createJobCatalogScenario` does not exist.

- [ ] **Step 4: Implement `job-scenario.ts`**

Create `apps/job-catalog-api/src/job-scenario.ts` with:

```ts
import {
  compensationPackSchema,
  employerPackSchema,
  jobPostingPackSchema,
  type CatalogManifest,
  type CommercialObject,
  type ObjectContract,
  type SyncCapability,
} from '@ocp-catalog/ocp-schema';
import {
  numberField,
  readDescriptorField,
  stringField,
  type CatalogScenarioModule,
  type SearchProjection,
} from '@ocp-catalog/catalog-core';
import type { z } from 'zod';

const packValidators: Record<string, z.ZodTypeAny> = {
  'ocp.job.posting.v1': jobPostingPackSchema,
  'ocp.organization.employer.v1': employerPackSchema,
  'ocp.compensation.v1': compensationPackSchema,
};

export function createJobCatalogScenario(options: { semanticSearchEnabled?: boolean } = {}): CatalogScenarioModule {
  return {
    description: 'Protocol-first OCP Job posting Catalog node.',
    registryVisibility: 'public',
    objectContracts: buildJobObjectContracts,
    providerSyncCapabilities: buildJobSyncCapabilities,
    queryCapabilities: () => buildJobQueryCapabilities(options),
    validateDescriptorPack,
    buildSearchProjection,
    buildExplainProjection,
    buildEmbeddingText,
    buildResolveActions,
    buildResolveAccess,
    buildResolveLiveChecks,
  };
}

function buildJobObjectContracts(): ObjectContract[] {
  return [{
    required_fields: [
      'ocp.job.posting.v1#/title',
      'ocp.job.posting.v1#/company',
      'ocp.job.posting.v1#/location',
      ['ocp.job.posting.v1#/job_url', 'ocp.job.posting.v1#/job_url_direct'],
    ],
    optional_fields: [
      'ocp.job.posting.v1#/site',
      'ocp.job.posting.v1#/date_posted',
      'ocp.job.posting.v1#/job_type',
      'ocp.job.posting.v1#/is_remote',
      'ocp.job.posting.v1#/job_level',
      'ocp.job.posting.v1#/job_function',
      'ocp.job.posting.v1#/listing_type',
      'ocp.job.posting.v1#/description',
      'ocp.job.posting.v1#/skills',
      'ocp.job.posting.v1#/experience_range',
      'ocp.job.posting.v1#/work_from_home_type',
      'ocp.organization.employer.v1#/company_industry',
      'ocp.organization.employer.v1#/company_url',
      'ocp.organization.employer.v1#/company_logo',
      'ocp.organization.employer.v1#/company_url_direct',
      'ocp.organization.employer.v1#/company_addresses',
      'ocp.organization.employer.v1#/company_num_employees',
      'ocp.organization.employer.v1#/company_revenue',
      'ocp.organization.employer.v1#/company_description',
      'ocp.organization.employer.v1#/company_rating',
      'ocp.organization.employer.v1#/company_reviews_count',
      'ocp.compensation.v1#/salary_source',
      'ocp.compensation.v1#/interval',
      'ocp.compensation.v1#/min_amount',
      'ocp.compensation.v1#/max_amount',
      'ocp.compensation.v1#/currency',
    ],
    additional_fields_policy: 'allow',
    field_usage_policy: [
      { field_ref: 'ocp.job.posting.v1#/title', requirement: 'required', usage: ['index', 'rank', 'display', 'search_visible', 'explain'] },
      { field_ref: 'ocp.job.posting.v1#/company', requirement: 'required', usage: ['index', 'filter', 'display', 'search_visible', 'explain'] },
      { field_ref: 'ocp.job.posting.v1#/location', requirement: 'required', usage: ['index', 'filter', 'display', 'search_visible', 'explain'] },
      { field_ref: 'ocp.job.posting.v1#/description', requirement: 'optional', usage: ['index', 'search_visible', 'resolve_visible'] },
      { field_ref: 'ocp.compensation.v1#/min_amount', requirement: 'optional', usage: ['filter', 'rank', 'display', 'search_visible'] },
      { field_ref: 'ocp.compensation.v1#/max_amount', requirement: 'optional', usage: ['filter', 'rank', 'display', 'search_visible'] },
    ],
    identity_policy: {
      accepted_identity_keys: ['provider_object_id', 'canonical_url'],
      dedupe_scope: 'provider',
      provider_sku_trust: 'not_accepted',
      requires_authority_verification: false,
    },
    provenance_requirements: {
      accepted_authority_types: ['external_source', 'imported_snapshot'],
      requires_verification: false,
    },
    resolve_policy: {
      strategies: ['source_url', 'catalog_cached'],
      requires_live_check: false,
      provider_endpoint_required: false,
    },
  }];
}

function buildJobSyncCapabilities(): SyncCapability[] {
  return [{
    capability_id: 'ocp.push.batch',
    description: 'Provider pushes batched job posting objects to the catalog sync API.',
    direction: 'provider_to_catalog',
    transport: 'http_push',
    sync_model: { snapshot: true, delta: false, stream: true },
    mutation_semantics: { upsert: true, delete: true },
    batching: { enabled: true, max_items: 1000, max_bytes: 1048576 },
    cursoring: { enabled: false },
    streaming: { enabled: true },
    auth: { schemes: ['x-api-key'] },
    endpoint_contract: {
      hosted_by: 'catalog',
      path_hint: '/ocp/objects/sync',
      required_endpoint_fields: [],
    },
    metadata: {
      stream_endpoint_path: '/ocp/objects/sync/stream',
      stream_content_type: 'application/x-ndjson',
      object_requirements: {
        kind: 'CommercialObject',
        object_type: 'job',
        required_descriptor_packs: ['ocp.job.posting.v1'],
      },
    },
  }];
}

function buildJobQueryCapabilities(options: { semanticSearchEnabled?: boolean }): CatalogManifest['query_capabilities'] {
  const queryPacks: CatalogManifest['query_capabilities'][number]['query_packs'] = [
    {
      pack_id: 'ocp.query.keyword.v1',
      description: 'Use for free-text job search over title, company, location, description, skills, industry, and function.',
      query_modes: ['keyword', 'hybrid'],
      metadata: {},
    },
    {
      pack_id: 'ocp.query.filter.v1',
      description: 'Use for structured job filtering by company, location, remote flag, job type, salary, currency, and source site.',
      query_modes: ['filter', 'hybrid'],
      metadata: {},
    },
  ];
  if (options.semanticSearchEnabled) {
    queryPacks.push({
      pack_id: 'ocp.query.semantic.v1',
      description: 'Use for meaning-based retrieval over embedded job posting representations.',
      query_modes: ['semantic', 'hybrid'],
      metadata: {
        semantic_search: {
          enabled: true,
          embedding_index: 'catalog_search_embeddings',
        },
      },
    });
  }

  return [{
    capability_id: 'ocp.job.search.v1',
    name: 'Job posting search',
    description: 'Searches job posting entries and returns resolvable job candidates.',
    query_packs: queryPacks,
    input_fields: [
      { name: 'query_pack', type: 'string', required: false },
      { name: 'query', type: 'string', required: false },
      { name: 'limit', type: 'number', required: false, default: 20, maximum: 50 },
      { name: 'offset', type: 'number', required: false, default: 0 },
      { name: 'filters.company', type: 'string', required: false },
      { name: 'filters.location', type: 'string', required: false },
      { name: 'filters.site', type: 'string', required: false },
      { name: 'filters.job_type', type: 'string', required: false },
      { name: 'filters.currency', type: 'string', required: false },
      { name: 'filters.is_remote', type: 'boolean', required: false },
      { name: 'filters.min_amount', type: 'number', required: false },
      { name: 'filters.max_amount', type: 'number', required: false },
      { name: 'filters.date_posted_from', type: 'string', required: false },
      { name: 'filters.date_posted_to', type: 'string', required: false },
      { name: 'filters.provider_id', type: 'string', required: false },
    ],
    searchable_field_refs: [
      'ocp.job.posting.v1#/title',
      'ocp.job.posting.v1#/company',
      'ocp.job.posting.v1#/location',
      'ocp.job.posting.v1#/description',
      'ocp.job.posting.v1#/skills',
      'ocp.organization.employer.v1#/company_industry',
      'ocp.organization.employer.v1#/company_description',
    ],
    filterable_field_refs: [
      'ocp.job.posting.v1#/company',
      'ocp.job.posting.v1#/location',
      'ocp.job.posting.v1#/site',
      'ocp.job.posting.v1#/job_type',
      'ocp.job.posting.v1#/is_remote',
      'ocp.job.posting.v1#/date_posted',
      'ocp.compensation.v1#/currency',
      'ocp.compensation.v1#/min_amount',
      'ocp.compensation.v1#/max_amount',
    ],
    sortable_field_refs: ['ocp.job.posting.v1#/date_posted'],
    supports_explain: true,
    supports_resolve: true,
    metadata: {
      query_hints: {
        filter_fields: ['company', 'location', 'site', 'job_type', 'currency', 'is_remote', 'min_amount', 'max_amount', 'date_posted_from', 'date_posted_to', 'provider_id'],
        supported_query_languages: ['en'],
        content_languages: ['en'],
      },
      semantic_search: {
        enabled: Boolean(options.semanticSearchEnabled),
        embedding_index: 'catalog_search_embeddings',
      },
    },
  }];
}

function validateDescriptorPack(packId: string, data: unknown) {
  const validator = packValidators[packId];
  if (!validator) return { ok: true as const, data };
  const result = validator.safeParse(data);
  if (result.success) return { ok: true as const, data: result.data };
  return {
    ok: false as const,
    errors: result.error.issues.map((issue) => `${packId}${issue.path.length ? `/${issue.path.join('/')}` : ''}: ${issue.message}`),
  };
}

function buildSearchProjection(object: CommercialObject): SearchProjection {
  const title = stringField(readDescriptorField(object, 'ocp.job.posting.v1#/title')) ?? object.title;
  const company = stringField(readDescriptorField(object, 'ocp.job.posting.v1#/company'));
  const location = stringField(readDescriptorField(object, 'ocp.job.posting.v1#/location'));
  const description = stringField(readDescriptorField(object, 'ocp.job.posting.v1#/description')) ?? object.summary;
  const site = stringField(readDescriptorField(object, 'ocp.job.posting.v1#/site'));
  const jobUrl = stringField(readDescriptorField(object, 'ocp.job.posting.v1#/job_url'));
  const jobUrlDirect = stringField(readDescriptorField(object, 'ocp.job.posting.v1#/job_url_direct'));
  const datePosted = stringField(readDescriptorField(object, 'ocp.job.posting.v1#/date_posted'));
  const jobType = stringField(readDescriptorField(object, 'ocp.job.posting.v1#/job_type'));
  const jobLevel = stringField(readDescriptorField(object, 'ocp.job.posting.v1#/job_level'));
  const jobFunction = stringField(readDescriptorField(object, 'ocp.job.posting.v1#/job_function'));
  const isRemote = readDescriptorField(object, 'ocp.job.posting.v1#/is_remote');
  const skills = readDescriptorField(object, 'ocp.job.posting.v1#/skills');
  const companyIndustry = stringField(readDescriptorField(object, 'ocp.organization.employer.v1#/company_industry'));
  const companyUrl = stringField(readDescriptorField(object, 'ocp.organization.employer.v1#/company_url'));
  const companyUrlDirect = stringField(readDescriptorField(object, 'ocp.organization.employer.v1#/company_url_direct'));
  const companyLogo = stringField(readDescriptorField(object, 'ocp.organization.employer.v1#/company_logo'));
  const interval = stringField(readDescriptorField(object, 'ocp.compensation.v1#/interval'));
  const minAmount = numberField(readDescriptorField(object, 'ocp.compensation.v1#/min_amount'));
  const maxAmount = numberField(readDescriptorField(object, 'ocp.compensation.v1#/max_amount'));
  const currency = stringField(readDescriptorField(object, 'ocp.compensation.v1#/currency'));
  const text = [
    title,
    company,
    location,
    description,
    site,
    jobType,
    jobLevel,
    jobFunction,
    companyIndustry,
    Array.isArray(skills) ? skills.join(' ') : undefined,
  ].filter(Boolean).join(' ').toLowerCase();

  return {
    title,
    ...(description ? { summary: description.slice(0, 500) } : {}),
    ...(company ? { company } : {}),
    ...(location ? { location } : {}),
    ...(site ? { site } : {}),
    ...(jobUrl ? { job_url: jobUrl } : {}),
    ...(jobUrlDirect ? { job_url_direct: jobUrlDirect } : {}),
    ...(datePosted ? { date_posted: datePosted } : {}),
    ...(jobType ? { job_type: jobType } : {}),
    ...(jobLevel ? { job_level: jobLevel } : {}),
    ...(jobFunction ? { job_function: jobFunction } : {}),
    ...(typeof isRemote === 'boolean' ? { is_remote: isRemote } : {}),
    ...(Array.isArray(skills) ? { skills } : {}),
    ...(companyIndustry ? { company_industry: companyIndustry } : {}),
    ...(companyUrl ? { company_url: companyUrl } : {}),
    ...(companyUrlDirect ? { company_url_direct: companyUrlDirect } : {}),
    ...(companyLogo ? { image_url: companyLogo, company_logo: companyLogo } : {}),
    ...(interval ? { interval } : {}),
    ...(minAmount !== undefined ? { min_amount: minAmount } : {}),
    ...(maxAmount !== undefined ? { max_amount: maxAmount } : {}),
    ...(currency ? { currency } : {}),
    ...(object.source_url ? { source_url: object.source_url } : {}),
    provider_id: object.provider_id,
    object_id: object.object_id,
    text,
  };
}

function buildExplainProjection(object: CommercialObject, projection: SearchProjection) {
  return {
    indexed_fields: Object.keys(projection).filter((key) => key !== 'text'),
    descriptor_packs: object.descriptors.map((descriptor) => descriptor.pack_id),
  };
}

function buildEmbeddingText(_object: CommercialObject, projection: SearchProjection) {
  return [
    projection.title,
    projection.summary,
    stringField(projection.company),
    stringField(projection.location),
    stringField(projection.job_type),
    stringField(projection.job_level),
    stringField(projection.job_function),
    Array.isArray(projection.skills) ? projection.skills.join(' ') : undefined,
    projection.text,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0).join('\n');
}

const buildResolveActions: NonNullable<CatalogScenarioModule['buildResolveActions']> = (context) => {
  const jobUrl = stringField(context.projection.job_url_direct)
    ?? stringField(context.projection.job_url)
    ?? stringField(context.projection.source_url);
  const companyUrl = stringField(context.projection.company_url_direct)
    ?? stringField(context.projection.company_url);
  return [
    ...(jobUrl ? [{
      action_id: 'view_job',
      action_type: 'url' as const,
      label: 'View job',
      description: 'Open the provider-owned job posting page.',
      entrypoint: { url: jobUrl, method: 'GET' as const },
      auth_requirements: {},
      requires_user_confirmation: false,
      expires_at: context.expires_at,
    }] : []),
    ...(companyUrl ? [{
      action_id: 'view_company',
      action_type: 'url' as const,
      label: 'View company',
      description: 'Open the employer page associated with this job posting.',
      entrypoint: { url: companyUrl, method: 'GET' as const },
      auth_requirements: {},
      requires_user_confirmation: false,
      expires_at: context.expires_at,
    }] : []),
  ];
};

const buildResolveAccess: NonNullable<CatalogScenarioModule['buildResolveAccess']> = () => ({
  visibility: 'public',
  permission_state: 'granted',
  redacted_fields: ['job_url', 'job_url_direct', 'company_url', 'company_url_direct', 'source_url', 'text'],
  policy_notes: ['Provider-owned URLs are exposed through action_bindings, not visible_attributes.'],
});

const buildResolveLiveChecks: NonNullable<CatalogScenarioModule['buildResolveLiveChecks']> = (context) => [{
  check_id: 'job_listing_snapshot',
  status: 'unknown',
  checked_at: context.resolved_at,
  summary: 'Job listing freshness is based on imported snapshot data; no live ATS status check is configured.',
  details: {},
}];
```

- [ ] **Step 5: Run scenario tests**

Run:

```powershell
bun test apps/job-catalog-api/src/job-scenario.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add apps/job-catalog-api/package.json apps/job-catalog-api/src/job-scenario.ts apps/job-catalog-api/src/job-scenario.test.ts
git commit -m "feat: add job catalog scenario"
```

## Task 3: Add Job Query Schema, Planner, and Service

**Files:**

- Create: `apps/job-catalog-api/src/query/job-query-schema.ts`
- Create: `apps/job-catalog-api/src/query/job-query-planner.ts`
- Create: `apps/job-catalog-api/src/query/job-query-service.ts`
- Create: `apps/job-catalog-api/src/query/job-query-service.test.ts`

- [ ] **Step 1: Write query schema tests**

Create `apps/job-catalog-api/src/query/job-query-service.test.ts` with tests that assert:

```ts
import { describe, expect, it } from 'bun:test';
import { jobCatalogQueryRequestSchema } from './job-query-schema';

describe('job query schema', () => {
  it('accepts job filters without commerce-only fields', () => {
    const request = jobCatalogQueryRequestSchema.parse({
      query_pack: 'ocp.query.filter.v1',
      filters: {
        company: 'Walmart',
        location: 'Sunnyvale, CA, US',
        is_remote: false,
        min_amount: 140000,
        max_amount: 300000,
        currency: 'USD',
        date_posted_from: '2026-07-01',
      },
      limit: 10,
    });
    expect(request.filters.company).toBe('Walmart');
    expect(request.offset).toBe(0);
  });

  it('rejects unknown filters instead of silently ignoring them', () => {
    const result = jobCatalogQueryRequestSchema.safeParse({
      filters: {
        brand: 'not a job field',
      },
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Implement query schema**

Create `apps/job-catalog-api/src/query/job-query-schema.ts`:

```ts
import { z } from 'zod';
import { catalogQueryModeSchema } from '@ocp-catalog/ocp-schema';

export const jobCatalogQueryFiltersSchema = z.object({
  company: z.string().min(1).optional(),
  location: z.string().min(1).optional(),
  site: z.string().min(1).optional(),
  job_type: z.string().min(1).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  is_remote: z.boolean().optional(),
  min_amount: z.number().nonnegative().optional(),
  max_amount: z.number().nonnegative().optional(),
  date_posted_from: z.string().min(1).optional(),
  date_posted_to: z.string().min(1).optional(),
  provider_id: z.string().min(1).optional(),
}).strict();

export const jobCatalogQueryRequestSchema = z.object({
  ocp_version: z.literal('1.0').optional(),
  kind: z.literal('CatalogQueryRequest').optional(),
  catalog_id: z.string().min(1).optional(),
  query_pack: z.string().min(1).optional(),
  query_mode: catalogQueryModeSchema.optional(),
  query: z.string().max(500).optional().default(''),
  filters: jobCatalogQueryFiltersSchema.optional().default({}),
  limit: z.number().int().min(1).max(50).optional().default(20),
  offset: z.literal(0).optional().default(0),
  explain: z.boolean().optional().default(true),
}).strict();

export type JobCatalogQueryRequest = z.infer<typeof jobCatalogQueryRequestSchema>;
```

- [ ] **Step 3: Implement planner**

Create `apps/job-catalog-api/src/query/job-query-planner.ts` by adapting the existing commerce planner shape, but with `ocp.job.search.v1` and the job scenario query packs. Semantic requests must throw explicit `invalid_query_mode` when semantic search is not configured.

- [ ] **Step 4: Implement query service**

Create `apps/job-catalog-api/src/query/job-query-service.ts` by adapting `CommerceQueryService` with these differences:

- Use `jobCatalogQueryRequestSchema`.
- Apply filters against `visibleAttributesPayload` for job-specific fields.
- Keep DB status conditions on `catalogSearchDocuments.catalogId` and `documentStatus='active'`.
- Keep OpenSearch text shortlist, PostgreSQL full-text fallback, semantic nearest-neighbor retrieval, and hybrid merge behavior.
- Replace `commerceQualityScore` with `jobQualityScore`.
- Throw semantic errors in semantic mode; only hybrid may degrade if the manifest declares hybrid and the failure is explicitly logged.

Minimum quality score:

```ts
function jobQualityScore(projection: Record<string, unknown>, filters: JobCatalogQueryRequest['filters']) {
  let score = 0;
  if (stringValue(projection.job_url_direct) || stringValue(projection.job_url)) score += 0.25;
  if (stringValue(projection.company)) score += 0.15;
  if (stringValue(projection.location)) score += 0.15;
  if (stringValue(projection.date_posted)) score += 0.15;
  if (numberValue(projection.min_amount) > 0 || numberValue(projection.max_amount) > 0) score += 0.1;
  if (filters.is_remote !== undefined && projection.is_remote === filters.is_remote) score += 0.1;
  return score;
}
```

- [ ] **Step 5: Run query tests**

Run:

```powershell
bun test apps/job-catalog-api/src/query/job-query-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add apps/job-catalog-api/src/query
git commit -m "feat: add job catalog query service"
```

## Task 4: Wire Independent Job Catalog API and Worker

**Files:**

- Create: `apps/job-catalog-api/src/config.ts`
- Create: `apps/job-catalog-api/src/runtime/context.ts`
- Create: `apps/job-catalog-api/src/http/app.ts`
- Create: `apps/job-catalog-api/src/http/routes/protocol.ts`
- Create: `apps/job-catalog-api/src/index.ts`
- Create: `apps/job-catalog-api/src/worker.ts`
- Modify: `package.json`
- Modify: `.env.example`

- [ ] **Step 1: Implement config**

Create `apps/job-catalog-api/src/config.ts` with the same operational config fields as commerce, but rename the exported types/functions to `JobCatalogConfig`, `loadJobCatalogConfig`, and `toCatalogCoreConfig`.

Required defaults:

```ts
CATALOG_API_PORT: 4300
CATALOG_ID: cat_ocp_jobs_dev
CATALOG_NAME: OCP Job Posting Catalog
OPENSEARCH_INDEX_NAME: ocp-job-catalog-vectors
```

- [ ] **Step 2: Implement runtime context**

Create `apps/job-catalog-api/src/runtime/context.ts` by wiring:

- `createJobCatalogScenario({ semanticSearchEnabled: true })`
- `createCatalogServices(...)`
- shared DB/activity DB
- embedding provider
- vector index adapter
- query embedding cache
- `JobQueryService`
- search index job service
- search document upsert service
- search embedding service
- embedding work item service
- batch backfill service
- search index worker
- catalog outbox service

Use commerce runtime as the reference but rename all commerce-specific variables.

- [ ] **Step 3: Implement protocol routes**

Create `apps/job-catalog-api/src/http/routes/protocol.ts` with the same endpoint surface as commerce:

- `GET /ocp/health`
- `GET /.well-known/ocp-catalog`
- `GET /ocp/manifest`
- `GET /ocp/contracts`
- `POST /ocp/providers/register`
- `POST /ocp/objects/sync`
- `POST /ocp/objects/sync/stream`
- `GET /ocp/object-sync-runs/:syncRunId`
- `POST /ocp/object-sync-runs/:syncRunId/complete`
- `POST /ocp/query`
- `POST /ocp/resolve`

Differences:

- Manifest uses `jobCatalogScenario`.
- Query uses `jobQueryService`.
- Data profile object count must report `{ object_type: 'job', count }`.
- Health details should use `active_job_count`, not `active_entry_count`.

- [ ] **Step 4: Add entrypoints**

Create `apps/job-catalog-api/src/index.ts`:

```ts
import { createJobCatalogApp } from './http/app';
import { createJobCatalogApiRuntimeContext, logEmbeddingProviderConfig } from './runtime/context';

const runtime = createJobCatalogApiRuntimeContext();
logEmbeddingProviderConfig(runtime);

const app = createJobCatalogApp(runtime);
app.listen(runtime.config.CATALOG_API_PORT);

console.log(`Job Catalog API listening on http://localhost:${app.server?.port}`);
```

Create `apps/job-catalog-api/src/worker.ts` following commerce worker behavior.

- [ ] **Step 5: Add root scripts**

Modify root `package.json`:

```json
{
  "scripts": {
    "job:catalog:api": "bun --cwd apps/job-catalog-api run src/index.ts",
    "job:catalog:worker": "bun --cwd apps/job-catalog-api run src/worker.ts",
    "job:catalog:test": "bun test apps/job-catalog-api/src"
  }
}
```

Preserve existing scripts.

- [ ] **Step 6: Smoke manifest locally**

Run:

```powershell
bun run job:catalog:test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add apps/job-catalog-api package.json .env.example
git commit -m "feat: wire independent job catalog app"
```

## Task 5: Implement JobSpy CSV Streaming Importer

**Files:**

- Create: `apps/job-catalog-api/src/scripts/jobspy-csv-to-ndjson.ts`
- Create: `apps/job-catalog-api/src/scripts/jobspy-csv-to-ndjson.test.ts`
- Create: `apps/job-catalog-api/src/scripts/import-jobspy-csv.ts`

- [ ] **Step 1: Write mapper tests**

Create tests covering:

- A row with salary maps compensation numbers.
- A row without salary omits compensation fields instead of inventing defaults.
- A row without URL fails loudly.
- `object_id` is stable as `${site}:${id}`.
- Long descriptions are bounded before descriptor validation.

- [ ] **Step 2: Implement row mapper**

Implement:

```ts
export function jobspyRowToCommercialObject(row: Record<string, string>, options: { providerId: string }) {
  const sourceUrl = clean(row.job_url_direct) ?? clean(row.job_url);
  if (!sourceUrl) throw new Error(`row ${row.id || '<missing id>'} is missing job_url and job_url_direct`);
  const title = requireString(row.title, 'title');
  const company = requireString(row.company, 'company');
  const location = requireString(row.location, 'location');
  const site = requireString(row.site, 'site');
  const objectId = `${site}:${requireString(row.id, 'id')}`;
  const description = clean(row.description);
  const skills = splitList(row.skills);

  return {
    ocp_version: '1.0',
    kind: 'CommercialObject',
    id: `${options.providerId}:${objectId}`,
    object_id: objectId,
    object_type: 'job',
    provider_id: options.providerId,
    title,
    summary: description ? description.slice(0, 500) : undefined,
    status: 'active',
    source_url: sourceUrl,
    provenance: {
      authority_type: 'external_source',
      provider_id: options.providerId,
      source: 'jobspy_csv',
      source_site: site,
      source_uri: sourceUrl,
      source_object_id: row.id,
      collected_at: new Date().toISOString(),
      verification_status: 'unverified',
      trust_tier: 'unverified',
    },
    descriptors: [
      {
        pack_id: 'ocp.job.posting.v1',
        data: compactObject({
          title,
          company,
          location,
          site,
          job_url: clean(row.job_url),
          job_url_direct: clean(row.job_url_direct),
          date_posted: clean(row.date_posted),
          job_type: clean(row.job_type),
          is_remote: parseBoolean(row.is_remote),
          job_level: clean(row.job_level),
          job_function: clean(row.job_function),
          listing_type: clean(row.listing_type),
          description: description ? description.slice(0, 24000) : undefined,
          skills: skills.length ? skills : undefined,
          experience_range: clean(row.experience_range),
          work_from_home_type: clean(row.work_from_home_type),
        }),
      },
      {
        pack_id: 'ocp.organization.employer.v1',
        data: compactObject({
          company,
          company_industry: clean(row.company_industry),
          company_url: clean(row.company_url),
          company_logo: clean(row.company_logo),
          company_url_direct: clean(row.company_url_direct),
          company_addresses: clean(row.company_addresses),
          company_num_employees: clean(row.company_num_employees),
          company_revenue: clean(row.company_revenue),
          company_description: clean(row.company_description),
          company_rating: parseNumber(row.company_rating),
          company_reviews_count: parseInteger(row.company_reviews_count),
        }),
      },
      {
        pack_id: 'ocp.compensation.v1',
        data: compactObject({
          salary_source: clean(row.salary_source),
          interval: normalizeInterval(row.interval),
          min_amount: parseNumber(row.min_amount),
          max_amount: parseNumber(row.max_amount),
          currency: clean(row.currency),
        }),
      },
    ],
  };
}
```

- [ ] **Step 3: Implement streaming CLI**

The CLI must stream CSV rows and write NDJSON to stdout. It must not load a full 13GB CSV into memory.

Run shape:

```powershell
bun run apps/job-catalog-api/src/scripts/jobspy-csv-to-ndjson.ts --input C:\path\indeed_2026-07-08.csv --provider-id jobspy_indeed > out.ndjson
```

- [ ] **Step 4: Implement importer**

`import-jobspy-csv.ts` should:

1. Register provider if needed.
2. Capture `provider_api_key` from registration result.
3. Stream mapped NDJSON to `/ocp/objects/sync/stream`.
4. Use stable `batch_id`, e.g. `jobspy-indeed-2026-07-08`.
5. Poll `/ocp/object-sync-runs/{sync_run_id}?provider_id=jobspy_indeed`.
6. Fail if rejected count is nonzero above a configured threshold.

- [ ] **Step 5: Test mapper**

Run:

```powershell
bun test apps/job-catalog-api/src/scripts/jobspy-csv-to-ndjson.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add apps/job-catalog-api/src/scripts
git commit -m "feat: add JobSpy CSV importer"
```

## Task 6: Validate Small End-to-End Sample

**Files:**

- Create: `apps/job-catalog-api/src/job-catalog-integration.test.ts`

- [ ] **Step 1: Build an integration test with three sample rows**

The test should:

1. Start with a test DB helper matching commerce integration tests.
2. Build job runtime context.
3. Register provider `jobspy_indeed`.
4. Sync three mapped `CommercialObject` items.
5. Run keyword query `AI Tooling Engineer`.
6. Run filter query `{ company: 'Walmart', is_remote: false }`.
7. Resolve one returned entry.
8. Assert `view_job` action exists.
9. Assert bad row without URL is rejected before sync.

- [ ] **Step 2: Run integration test**

Run:

```powershell
bun test apps/job-catalog-api/src/job-catalog-integration.test.ts
```

Expected: PASS with local Postgres available.

- [ ] **Step 3: Commit**

```powershell
git add apps/job-catalog-api/src/job-catalog-integration.test.ts
git commit -m "test: validate job catalog sync query resolve"
```

## Task 7: Throughput and Indexing Validation

**Files:**

- Create: `apps/job-catalog-api/src/scripts/benchmark-jobspy-import.ts`
- Modify: `README.md`

- [ ] **Step 1: Add benchmark script**

The benchmark should import a bounded row count from a CSV, for example 10k rows, and report:

- CSV rows read
- mapped objects
- rejected rows before sync
- sync accepted/rejected counts
- total sync duration
- rows/sec
- pending search index jobs
- completed search document count
- pending embedding work items

- [ ] **Step 2: Run bounded local benchmark**

Run:

```powershell
bun run apps/job-catalog-api/src/scripts/benchmark-jobspy-import.ts --input sample.csv --limit 10000
```

Expected:

- No memory growth proportional to file size.
- No direct DB writes outside object sync.
- Rejected rows are explicit with row number and reason.

- [ ] **Step 3: Document import guidance**

Update `README.md` with:

- How to run Job Catalog API and worker.
- How to register/import JobSpy CSV.
- Recommended initial batch/chunk size.
- How to inspect sync run status.
- How to inspect search index backlog.

- [ ] **Step 4: Commit**

```powershell
git add apps/job-catalog-api/src/scripts/benchmark-jobspy-import.ts README.md
git commit -m "docs: add job catalog import validation"
```

## Task 8: Registration and OCP CLI Smoke

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Start local services**

Run:

```powershell
bun run job:catalog:api
bun run job:catalog:worker
```

- [ ] **Step 2: Inspect manifest**

Run:

```powershell
ocp catalog inspect http://localhost:4300/ocp/manifest
```

Expected:

- `catalog_id` is `cat_ocp_jobs_dev`.
- `query_capabilities[0].capability_id` is `ocp.job.search.v1`.
- Query packs include keyword/filter and semantic when enabled.
- Object contracts include `ocp.job.posting.v1`.

- [ ] **Step 3: Query through OCP CLI**

Run:

```powershell
ocp catalog query http://localhost:4300/ocp/query --manifest http://localhost:4300/ocp/manifest --query "AI tooling engineer" --limit 5
```

Expected: structured query result with job entries after sample import.

- [ ] **Step 4: Resolve through OCP CLI**

Run:

```powershell
ocp catalog resolve http://localhost:4300/ocp/resolve --entry-id <entry_id>
```

Expected: `ResolvableReference` with `view_job` action.

- [ ] **Step 5: Commit docs updates**

```powershell
git add README.md
git commit -m "docs: document job catalog OCP smoke path"
```

## Deployment Plan

For first production-like deployment, use a separate process group and database/schema decision.

Recommended first deployment:

1. Use the existing catalog database only if `catalog_id` separation is accepted and current table indexes are sufficient.
2. Prefer a separate database for the first large import if we want isolated blast radius from the commerce production catalog.
3. Run `job:catalog:api` on a separate port, for example `4300`.
4. Run `job:catalog:worker` separately with conservative concurrency.
5. Import one daily CSV first, not `indeed_master.csv`.
6. Validate query/resolve and index backlog.
7. Only then import `indeed_master.csv`.

Do not register publicly until:

- Manifest is valid.
- Health reports ready.
- Query on sample data works.
- Resolve returns action bindings.
- Index backlog drains.
- Rejected import rows are understood.

## Verification Checklist

- [ ] `bun test packages/ocp-schema/src/job-packs.test.ts`
- [ ] `bun test apps/job-catalog-api/src/job-scenario.test.ts`
- [ ] `bun test apps/job-catalog-api/src/query/job-query-service.test.ts`
- [ ] `bun test apps/job-catalog-api/src/scripts/jobspy-csv-to-ndjson.test.ts`
- [ ] `bun test apps/job-catalog-api/src/job-catalog-integration.test.ts`
- [ ] `bun run typecheck`
- [ ] `bun run build`
- [ ] `ocp catalog inspect http://localhost:4300/ocp/manifest`
- [ ] `ocp catalog query ...`
- [ ] `ocp catalog resolve ...`

Failure-path checks:

- [ ] Missing `title` rejects row.
- [ ] Missing `company` rejects row.
- [ ] Missing `location` rejects row.
- [ ] Missing both `job_url` and `job_url_direct` rejects row.
- [ ] Invalid URL rejects descriptor validation.
- [ ] Unknown job filter rejects request.
- [ ] Semantic query fails loudly when embeddings/retrieval are unavailable.
- [ ] Reusing a `batch_id` with different payload returns conflict.

## Open Questions Before Execution

1. Should first deployment use the existing catalog DB or a separate job catalog DB?
2. Should `emails` be dropped completely, stored as `never_expose`, or excluded from import until there is an explicit contact policy?
3. Should `indeed_master.csv` be treated as authoritative full snapshot, with daily files as deltas, or should all files be imported with dedupe by `site:id`?
4. Should public Registration expose the Job Catalog immediately after sample import, or wait until the full master import and embedding backlog are complete?

## Self-Review

Spec coverage:

- Independent Job Catalog instance: covered by Tasks 2, 4, 8.
- Reuse commerce IO/index optimizations: covered by Tasks 4, 5, 7.
- Avoid hard-fitting commerce model: covered by descriptor packs, job scenario, and job query schema.
- Fail-loud boundaries: covered by schema tests, mapper tests, query schema strictness, sync replay conflict checks.
- OCP registration/query/resolve workflow: covered by Tasks 6 and 8.

Placeholder scan:

- No `TBD` or vague implementation-only steps remain.
- Each code-producing task names exact files and includes concrete code or required behavior.

Type consistency:

- Scenario exports `createJobCatalogScenario`.
- Query schema exports `jobCatalogQueryRequestSchema`.
- Runtime should use `JobQueryService`.
- Descriptor pack exports are `jobPostingPackSchema`, `employerPackSchema`, and `compensationPackSchema`.
