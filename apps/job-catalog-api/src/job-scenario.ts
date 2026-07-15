import {
  numberField,
  readDescriptorField,
  stringField,
  type CatalogScenarioModule,
  type SearchProjection,
} from '@ocp-catalog/catalog-core';
import type { CatalogManifest, CommercialObject, ObjectContract, SyncCapability } from '@ocp-catalog/ocp-schema';
import type { z } from 'zod';
import {
  JOB_COMPANY_PACK_ID,
  JOB_COMPENSATION_PACK_ID,
  JOB_POSTING_PACK_ID,
  JOB_REQUIREMENTS_PACK_ID,
  JOB_WORKPLACE_PACK_ID,
  jobPackValidators,
} from './job-packs';

export function createJobCatalogScenario(options: { semanticQueryEnabled?: boolean } = {}): CatalogScenarioModule {
  return {
    description: 'Protocol-first OCP Catalog node for overseas job postings.',
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
  return [
    {
      required_fields: [
        `${JOB_POSTING_PACK_ID}#/title`,
        `${JOB_POSTING_PACK_ID}#/company_name`,
        `${JOB_POSTING_PACK_ID}#/location_text`,
        [
          `${JOB_POSTING_PACK_ID}#/job_url`,
          `${JOB_POSTING_PACK_ID}#/job_url_direct`,
        ],
      ],
      optional_fields: [
        `${JOB_POSTING_PACK_ID}#/date_posted`,
        `${JOB_POSTING_PACK_ID}#/description`,
        `${JOB_POSTING_PACK_ID}#/site`,
        `${JOB_POSTING_PACK_ID}#/source_id`,
        `${JOB_COMPENSATION_PACK_ID}#/salary_source`,
        `${JOB_COMPENSATION_PACK_ID}#/interval`,
        `${JOB_COMPENSATION_PACK_ID}#/min_amount`,
        `${JOB_COMPENSATION_PACK_ID}#/max_amount`,
        `${JOB_COMPENSATION_PACK_ID}#/currency`,
        `${JOB_WORKPLACE_PACK_ID}#/is_remote`,
        `${JOB_WORKPLACE_PACK_ID}#/work_from_home_type`,
        `${JOB_COMPANY_PACK_ID}#/company_url`,
        `${JOB_COMPANY_PACK_ID}#/company_logo`,
        `${JOB_COMPANY_PACK_ID}#/company_industry`,
        `${JOB_COMPANY_PACK_ID}#/company_rating`,
        `${JOB_COMPANY_PACK_ID}#/company_reviews_count`,
        `${JOB_COMPANY_PACK_ID}#/company_description`,
        `${JOB_REQUIREMENTS_PACK_ID}#/skills`,
        `${JOB_REQUIREMENTS_PACK_ID}#/experience_range`,
        `${JOB_REQUIREMENTS_PACK_ID}#/job_level`,
        `${JOB_REQUIREMENTS_PACK_ID}#/job_function`,
        `${JOB_REQUIREMENTS_PACK_ID}#/job_type`,
      ],
      additional_fields_policy: 'allow',
      identity_policy: {
        accepted_identity_keys: ['provider_object_id', 'canonical_url', 'content_hash'],
        dedupe_scope: 'provider',
        provider_sku_trust: 'not_accepted',
        requires_authority_verification: false,
      },
      resolve_policy: {
        strategies: ['source_url'],
        requires_live_check: false,
        provider_endpoint_required: false,
      },
      field_usage_policy: [
        {
          field_ref: `${JOB_POSTING_PACK_ID}#/title`,
          requirement: 'required',
          usage: ['index', 'rank', 'display', 'search_visible', 'explain'],
        },
        {
          field_ref: `${JOB_POSTING_PACK_ID}#/company_name`,
          requirement: 'required',
          usage: ['index', 'filter', 'display', 'search_visible', 'explain'],
        },
        {
          field_ref: `${JOB_POSTING_PACK_ID}#/location_text`,
          requirement: 'required',
          usage: ['index', 'filter', 'display', 'search_visible', 'explain'],
        },
        {
          field_ref: `${JOB_POSTING_PACK_ID}#/job_url`,
          requirement: 'accepted',
          usage: ['resolve', 'reference', 'never_expose'],
        },
      ],
    },
  ];
}

function buildJobSyncCapabilities(): SyncCapability[] {
  return [
    {
      capability_id: 'ocp.push.batch',
      description: 'Provider pushes batched or streamed job objects to the catalog sync API.',
      direction: 'provider_to_catalog',
      transport: 'http_push',
      sync_model: {
        snapshot: true,
        delta: false,
        stream: true,
      },
      mutation_semantics: {
        upsert: true,
        delete: true,
      },
      batching: {
        enabled: true,
        max_items: 1000,
        max_bytes: 1048576,
      },
      cursoring: {
        enabled: false,
      },
      streaming: {
        enabled: true,
      },
      auth: {
        schemes: ['x-api-key'],
      },
      endpoint_contract: {
        hosted_by: 'catalog',
        path_hint: '/ocp/objects/sync',
        required_endpoint_fields: [],
      },
      metadata: {
        stream_endpoint_path: '/ocp/objects/sync/stream',
        run_status_endpoint_path: '/ocp/object-sync-runs/{sync_run_id}?provider_id={provider_id}',
        stream_content_type: 'application/x-ndjson',
        object_requirements: {
          kind: 'CommercialObject',
          object_type: 'job',
          required_descriptor_packs: [JOB_POSTING_PACK_ID, JOB_WORKPLACE_PACK_ID],
          minimum_required_fields: [
            'object_id',
            'object_type',
            'provider_id',
            'title',
            `${JOB_POSTING_PACK_ID}#/title`,
            `${JOB_POSTING_PACK_ID}#/company_name`,
            `${JOB_POSTING_PACK_ID}#/location_text`,
            `${JOB_POSTING_PACK_ID}#/job_url or ${JOB_POSTING_PACK_ID}#/job_url_direct`,
          ],
        },
      },
    },
  ];
}

function buildJobQueryCapabilities(options: { semanticQueryEnabled?: boolean }): CatalogManifest['query_capabilities'] {
  const queryPacks: CatalogManifest['query_capabilities'][number]['query_packs'] = [
    {
      pack_id: 'ocp.query.keyword.v1',
      description: 'Use for free-text job search over title, company, location, description, requirements, and source site.',
      query_modes: ['keyword'],
      metadata: {
        example_request: {
          catalog_id: '<catalog_id>',
          query_pack: 'ocp.query.keyword.v1',
          query: 'AI tooling engineer San Francisco',
          filters: {},
          limit: 10,
          cursor: '<opaque cursor from the previous page>',
        },
      },
    },
    {
      pack_id: 'ocp.query.filter.v1',
      description: 'Use for structured job browsing and filtered lists.',
      query_modes: ['filter'],
      metadata: {
        example_request: {
          catalog_id: '<catalog_id>',
          query_pack: 'ocp.query.filter.v1',
          filters: {
            company: 'Walmart',
            is_remote: true,
          },
          limit: 20,
          cursor: '<opaque cursor from the previous page>',
        },
      },
    },
    {
      pack_id: 'ocp.job.search.v1',
      description: 'Job-specific search pack with job filters and resolvable apply links.',
      query_modes: ['keyword', 'filter'],
      metadata: {
        filter_fields: [
          'company',
          'location',
          'site',
          'is_remote',
          'work_from_home_type',
          'job_type',
          'job_level',
          'job_function',
          'currency',
          'salary_min',
          'salary_max',
          'date_posted_after',
          'date_posted_before',
          'provider_id',
          'has_salary',
          'has_direct_url',
        ],
      },
    },
  ];

  if (options.semanticQueryEnabled) {
    queryPacks.push({
      pack_id: 'ocp.query.semantic.v1',
      description: 'Semantic job retrieval. Only enabled when the job embedding/index service is ready.',
      query_modes: ['semantic', 'hybrid'],
      metadata: {
        semantic_search: {
          enabled: true,
        },
      },
    });
  }

  return [
    {
      capability_id: 'ocp.job.search.v1',
      name: 'Overseas job search',
      description: 'Searches overseas job postings and returns resolvable job candidates.',
      query_packs: queryPacks,
      input_fields: [
        { name: 'query_pack', type: 'string', required: false },
        { name: 'query', type: 'string', required: false },
        { name: 'limit', type: 'number', required: false, default: 20, maximum: 50 },
        { name: 'cursor', type: 'string', required: false, description: 'Opaque cursor returned as page.next_cursor.' },
        { name: 'filters.company', type: 'string', required: false },
        { name: 'filters.location', type: 'string', required: false },
        { name: 'filters.site', type: 'string', required: false },
        { name: 'filters.is_remote', type: 'boolean', required: false },
        { name: 'filters.work_from_home_type', type: 'string', required: false },
        { name: 'filters.job_type', type: 'string', required: false },
        { name: 'filters.job_level', type: 'string', required: false },
        { name: 'filters.job_function', type: 'string', required: false },
        { name: 'filters.currency', type: 'string', required: false },
        { name: 'filters.salary_min', type: 'number', required: false },
        { name: 'filters.salary_max', type: 'number', required: false },
        { name: 'filters.date_posted_after', type: 'string', required: false },
        { name: 'filters.date_posted_before', type: 'string', required: false },
        { name: 'filters.provider_id', type: 'string', required: false },
        { name: 'filters.has_salary', type: 'boolean', required: false },
        { name: 'filters.has_direct_url', type: 'boolean', required: false },
      ],
      searchable_field_refs: [
        `${JOB_POSTING_PACK_ID}#/title`,
        `${JOB_POSTING_PACK_ID}#/company_name`,
        `${JOB_POSTING_PACK_ID}#/location_text`,
        `${JOB_POSTING_PACK_ID}#/description`,
        `${JOB_REQUIREMENTS_PACK_ID}#/skills`,
      ],
      filterable_field_refs: [
        `${JOB_POSTING_PACK_ID}#/company_name`,
        `${JOB_POSTING_PACK_ID}#/location_text`,
        `${JOB_POSTING_PACK_ID}#/site`,
        `${JOB_WORKPLACE_PACK_ID}#/is_remote`,
        `${JOB_COMPENSATION_PACK_ID}#/currency`,
        `${JOB_REQUIREMENTS_PACK_ID}#/job_type`,
        `${JOB_REQUIREMENTS_PACK_ID}#/job_level`,
        `${JOB_REQUIREMENTS_PACK_ID}#/job_function`,
      ],
      sortable_field_refs: [],
      supports_explain: true,
      supports_resolve: true,
      metadata: {
        semantic_search: {
          enabled: Boolean(options.semanticQueryEnabled),
          failure_policy: 'semantic requests fail when the semantic index is not enabled; keyword/filter results are not returned as a silent fallback.',
        },
      },
    },
  ];
}

function validateDescriptorPack(packId: string, data: unknown) {
  const validator = jobPackValidators[packId] as z.ZodTypeAny | undefined;
  if (!validator) return { ok: true as const, data };

  const result = validator.safeParse(data);
  if (result.success) return { ok: true as const, data: result.data };

  return {
    ok: false as const,
    errors: result.error.issues.map((issue) => `${packId}${issue.path.length ? `/${issue.path.join('/')}` : ''}: ${issue.message}`),
  };
}

function buildSearchProjection(object: CommercialObject): SearchProjection {
  const title = stringField(readDescriptorField(object, `${JOB_POSTING_PACK_ID}#/title`)) ?? object.title;
  const company = requiredProjectionString(object, `${JOB_POSTING_PACK_ID}#/company_name`, 'company_name');
  const location = requiredProjectionString(object, `${JOB_POSTING_PACK_ID}#/location_text`, 'location_text');
  const description = stringField(readDescriptorField(object, `${JOB_POSTING_PACK_ID}#/description`)) ?? object.summary;
  const jobUrl = stringField(readDescriptorField(object, `${JOB_POSTING_PACK_ID}#/job_url`));
  const jobUrlDirect = stringField(readDescriptorField(object, `${JOB_POSTING_PACK_ID}#/job_url_direct`));
  const site = stringField(readDescriptorField(object, `${JOB_POSTING_PACK_ID}#/site`));
  const datePosted = stringField(readDescriptorField(object, `${JOB_POSTING_PACK_ID}#/date_posted`));
  const salaryMin = numberField(readDescriptorField(object, `${JOB_COMPENSATION_PACK_ID}#/min_amount`));
  const salaryMax = numberField(readDescriptorField(object, `${JOB_COMPENSATION_PACK_ID}#/max_amount`));
  const currency = stringField(readDescriptorField(object, `${JOB_COMPENSATION_PACK_ID}#/currency`));
  const interval = stringField(readDescriptorField(object, `${JOB_COMPENSATION_PACK_ID}#/interval`));
  const isRemote = readDescriptorField(object, `${JOB_WORKPLACE_PACK_ID}#/is_remote`);
  const workFromHomeType = stringField(readDescriptorField(object, `${JOB_WORKPLACE_PACK_ID}#/work_from_home_type`));
  const companyIndustry = stringField(readDescriptorField(object, `${JOB_COMPANY_PACK_ID}#/company_industry`));
  const companyRating = numberField(readDescriptorField(object, `${JOB_COMPANY_PACK_ID}#/company_rating`));
  const skills = stringField(readDescriptorField(object, `${JOB_REQUIREMENTS_PACK_ID}#/skills`));
  const experienceRange = stringField(readDescriptorField(object, `${JOB_REQUIREMENTS_PACK_ID}#/experience_range`));
  const jobLevel = stringField(readDescriptorField(object, `${JOB_REQUIREMENTS_PACK_ID}#/job_level`));
  const jobFunction = stringField(readDescriptorField(object, `${JOB_REQUIREMENTS_PACK_ID}#/job_function`));
  const jobType = stringField(readDescriptorField(object, `${JOB_REQUIREMENTS_PACK_ID}#/job_type`));
  const applyUrl = jobUrlDirect ?? jobUrl ?? object.source_url;

  const text = [
    title,
    company,
    location,
    site,
    description,
    skills,
    experienceRange,
    jobLevel,
    jobFunction,
    jobType,
    companyIndustry,
    currency,
    interval,
    workFromHomeType,
  ].filter(Boolean).join(' ').toLowerCase();

  return {
    title,
    ...(description ? { summary: description.slice(0, 500) } : {}),
    company,
    location,
    ...(site ? { site } : {}),
    ...(datePosted ? { date_posted: datePosted } : {}),
    ...(jobUrl ? { job_url: jobUrl } : {}),
    ...(jobUrlDirect ? { job_url_direct: jobUrlDirect } : {}),
    ...(applyUrl ? { apply_url: applyUrl } : {}),
    ...(salaryMin !== undefined ? { salary_min: salaryMin } : {}),
    ...(salaryMax !== undefined ? { salary_max: salaryMax } : {}),
    ...(currency ? { currency } : {}),
    ...(interval ? { salary_interval: interval } : {}),
    ...(typeof isRemote === 'boolean' ? { is_remote: isRemote } : {}),
    ...(workFromHomeType ? { work_from_home_type: workFromHomeType } : {}),
    ...(companyIndustry ? { company_industry: companyIndustry } : {}),
    ...(companyRating !== undefined ? { company_rating: companyRating } : {}),
    ...(skills ? { skills } : {}),
    ...(experienceRange ? { experience_range: experienceRange } : {}),
    ...(jobLevel ? { job_level: jobLevel } : {}),
    ...(jobFunction ? { job_function: jobFunction } : {}),
    ...(jobType ? { job_type: jobType } : {}),
    has_salary: salaryMin !== undefined || salaryMax !== undefined,
    has_direct_url: Boolean(jobUrlDirect),
    source_url: object.source_url ?? applyUrl,
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
    projection.company,
    projection.location,
    projection.summary,
    projection.skills,
    projection.experience_range,
    projection.job_level,
    projection.job_function,
    projection.job_type,
    projection.text,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0).join('\n');
}

const buildResolveActions: NonNullable<CatalogScenarioModule['buildResolveActions']> = (context) => {
  const url = typeof context.projection.apply_url === 'string'
    ? context.projection.apply_url
    : typeof context.projection.source_url === 'string'
      ? context.projection.source_url
      : null;

  if (!url) return [];

  return [
    {
      action_id: 'open_job',
      action_type: 'url',
      label: 'Open job',
      description: 'Open the source job posting or direct apply page.',
      entrypoint: {
        url,
        method: 'GET',
      },
      auth_requirements: {},
      requires_user_confirmation: false,
      expires_at: context.expires_at,
    },
  ];
};

const buildResolveAccess: NonNullable<CatalogScenarioModule['buildResolveAccess']> = () => ({
  visibility: 'public',
  permission_state: 'granted',
  redacted_fields: ['job_url', 'job_url_direct', 'apply_url', 'source_url', 'text'],
  policy_notes: ['Source apply URLs are exposed through action_bindings, not visible_attributes.'],
});

const buildResolveLiveChecks: NonNullable<CatalogScenarioModule['buildResolveLiveChecks']> = (context) => [{
  check_id: 'source_apply_url_present',
  status: typeof context.projection.apply_url === 'string' ? 'passed' : 'failed',
  checked_at: context.resolved_at,
  summary: typeof context.projection.apply_url === 'string' ? 'Apply URL is present.' : 'Apply URL is missing.',
  details: {},
}];

function requiredProjectionString(object: CommercialObject, fieldRef: string, label: string) {
  const value = stringField(readDescriptorField(object, fieldRef));
  if (!value) throw new Error(`Cannot build job projection without ${label}`);
  return value;
}
