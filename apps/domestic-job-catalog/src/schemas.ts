import { z } from "zod";

export const recruitmentTypeSchema = z.enum(["campus", "social", "internship"]);
export const matchingModeSchema = z.enum(["computer", "filter_only"]);
export const classificationStatusSchema = z.enum(["classified", "review_required", "unclassified"]);

export const skillSchema = z.object({
  name: z.string().min(1),
  level: z.string().min(1).optional(),
  min_years: z.number().nonnegative().optional(),
  requirement_type: z.enum(["required", "optional", "bonus"]).default("required"),
  group_name: z.string().min(1).optional(),
  weight: z.number().int().min(1).max(10).optional(),
}).strict();

export const experienceSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["core", "bonus"]).default("core"),
  min_years: z.number().nonnegative().optional(),
  description: z.string().optional(),
  keywords: z.array(z.string().min(1)).default([]),
  weight: z.number().int().min(1).max(10).optional(),
}).strict();

export const educationSchema = z.object({
  min_degree: z.string().min(1).optional(),
  prefer_degrees: z.array(z.string().min(1)).default([]),
  required_majors: z.array(z.string().min(1)).default([]),
  preferred_majors: z.array(z.string().min(1)).default([]),
  certifications: z.array(z.string().min(1)).default([]),
}).strict();

export const domesticJobInputSchema = z.object({
  provider_id: z.string().min(1),
  external_job_id: z.string().min(1),
  title: z.string().min(1),
  company: z.string().min(1),
  description: z.string().min(1),
  apply_url: z.string().url(),
  source_platform: z.string().min(1),
  source_url: z.string().url().optional(),
  job_status: z.literal("active"),
  fetched_at: z.string().datetime(),
  updated_at: z.string().datetime().optional(),
  province: z.string().min(1).optional(),
  city: z.string().min(1),
  district: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
  remote_type: z.string().min(1).optional(),
  recruitment_type: recruitmentTypeSchema,
  matching_mode: matchingModeSchema,
  classification_status: classificationStatusSchema.default("classified"),
  classification_confidence: z.enum(["high", "medium", "low"]).optional(),
  job_type: z.string().min(1).optional(),
  job_family: z.string().min(1),
  industry_code: z.string().min(1).optional(),
  industry_category_code: z.string().min(1).optional(),
  salary_min: z.number().int().nonnegative().optional(),
  salary_max: z.number().int().nonnegative().optional(),
  salary_months_min: z.number().int().min(1).max(24).optional(),
  salary_months_max: z.number().int().min(1).max(24).optional(),
  currency: z.string().min(1).default("CNY"),
  min_total_years: z.number().int().nonnegative().optional(),
  max_total_years: z.number().int().nonnegative().optional(),
  education: educationSchema.default({ prefer_degrees: [], required_majors: [], preferred_majors: [], certifications: [] }),
  skills: z.array(skillSchema).default([]),
  experiences: z.array(experienceSchema).default([]),
  tags: z.array(z.object({
    name: z.string().min(1),
    category: z.string().min(1).optional(),
    weight: z.number().int().min(1).max(10).optional(),
  }).strict()).default([]),
  responsibilities: z.array(z.string().min(1)).default([]),
  highlights: z.array(z.string().min(1)).default([]),
  evidence: z.array(z.string().min(1)).min(1),
  schema_version: z.string().min(1).default("ocp.job.domestic.v1"),
  raw_payload: z.record(z.unknown()).default({}),
}).strict().superRefine((value, ctx) => {
  if (value.classification_status !== "classified") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["classification_status"],
      message: "Only classified jobs can be ingested as active catalog entries.",
    });
  }
  if (value.matching_mode === "computer") {
    if (value.skills.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["skills"],
        message: "computer jobs require at least one skill signal.",
      });
    }
    if (value.experiences.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["experiences"],
        message: "computer jobs require at least one experience signal.",
      });
    }
  }
});

export const filtersSchema = z.object({
  provider_id: z.string().min(1).optional(),
  province: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  cities: z.array(z.string().min(1)).optional(),
  district: z.string().min(1).optional(),
  recruitment_type: recruitmentTypeSchema.optional(),
  matching_mode: matchingModeSchema.optional(),
  job_family: z.string().min(1).optional(),
  job_type: z.string().min(1).optional(),
  remote_type: z.string().min(1).optional(),
  salary_min: z.number().int().nonnegative().optional(),
  salary_max: z.number().int().nonnegative().optional(),
  min_required_years: z.number().int().nonnegative().optional(),
  max_required_years: z.number().int().nonnegative().optional(),
  max_acceptable_degree_rank: z.number().int().min(1).max(5).optional(),
  min_acceptable_degree_rank: z.number().int().min(1).max(5).optional(),
  tag: z.string().min(1).optional(),
}).strict();

export const candidateProfileSchema = z.object({
  basic_info: z.object({
    work_years: z.number().int().nonnegative().optional(),
    highest_degree: z.string().min(1).optional(),
    current_city: z.string().min(1).optional(),
    current_title: z.string().min(1).optional(),
    summary: z.string().min(1).optional(),
  }).strict().default({}),
  target: z.object({
    recruitment_type: recruitmentTypeSchema.optional(),
    cities: z.array(z.string().min(1)).default([]),
    job_families: z.array(z.string().min(1)).default([]),
    min_acceptable_annual_salary: z.number().int().nonnegative().optional(),
  }).strict().default({ cities: [], job_families: [] }),
  skills: z.array(z.object({
    name: z.string().min(1),
    level: z.string().min(1).optional(),
    years: z.number().int().nonnegative().optional(),
  }).strict()).default([]),
  work_experiences: z.array(z.object({
    company_name: z.string().min(1).optional(),
    industry: z.string().min(1).optional(),
    title: z.string().min(1),
    description: z.string().min(1).optional(),
    responsibilities: z.array(z.string().min(1)).default([]),
    achievements: z.array(z.string().min(1)).default([]),
    tech_stack: z.array(z.string().min(1)).default([]),
  }).strict()).default([]),
  projects: z.array(z.object({
    name: z.string().min(1),
    role: z.string().min(1).optional(),
    domain: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    responsibilities: z.array(z.string().min(1)).default([]),
    achievements: z.array(z.string().min(1)).default([]),
    tech_stack: z.array(z.string().min(1)).default([]),
  }).strict()).default([]),
  educations: z.array(z.object({
    school: z.string().min(1).optional(),
    degree: z.string().min(1).optional(),
    major: z.string().min(1).optional(),
  }).strict()).default([]),
  tags: z.array(z.object({
    name: z.string().min(1),
    category: z.string().min(1).optional(),
  }).strict()).default([]),
}).strict();

export const catalogQueryRequestSchema = z.object({
  ocp_version: z.literal("1.0").optional(),
  kind: z.literal("CatalogQueryRequest").optional(),
  catalog_id: z.string().min(1).optional(),
  query_pack: z.enum([
    "ocp.query.filter.v1",
    "ocp.query.keyword.v1",
    "ocp.query.semantic.v1",
    "ocp.job.domestic.filter.v1",
    "ocp.job.domestic.match_candidate.v1",
  ]).optional(),
  query_mode: z.enum(["filter", "keyword", "semantic", "hybrid"]).optional(),
  query: z.string().max(1000).optional().default(""),
  filters: filtersSchema.optional().default({}),
  candidate_profile: candidateProfileSchema.optional(),
  limit: z.number().int().min(1).max(100).optional().default(20),
  offset: z.literal(0).optional().default(0),
  explain: z.boolean().optional().default(true),
}).strict();

export const objectSyncRequestSchema = z.object({
  ocp_version: z.literal("1.0").optional(),
  kind: z.literal("ObjectSyncRequest").optional(),
  catalog_id: z.string().min(1),
  provider_id: z.string().min(1).optional(),
  objects: z.array(z.unknown()).min(1).max(1000),
}).strict();

export type DomesticJobInput = z.infer<typeof domesticJobInputSchema>;
export type CatalogQueryRequest = z.infer<typeof catalogQueryRequestSchema>;
export type CandidateProfile = z.infer<typeof candidateProfileSchema>;
export type Filters = z.infer<typeof filtersSchema>;
