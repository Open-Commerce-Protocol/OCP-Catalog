import { z } from 'zod';

export const JOB_POSTING_PACK_ID = 'ocp.job.posting.v1';
export const JOB_COMPENSATION_PACK_ID = 'ocp.job.compensation.v1';
export const JOB_WORKPLACE_PACK_ID = 'ocp.job.workplace.v1';
export const JOB_COMPANY_PACK_ID = 'ocp.job.company.v1';
export const JOB_REQUIREMENTS_PACK_ID = 'ocp.job.requirements.v1';

export const jobPostingPackSchema = z.object({
  title: z.string().min(1),
  company_name: z.string().min(1),
  location_text: z.string().min(1),
  job_url: z.string().url().optional(),
  job_url_direct: z.string().url().optional(),
  date_posted: z.string().min(1).optional(),
  description: z.string().optional(),
  site: z.string().min(1).optional(),
  source_id: z.string().min(1).optional(),
}).strict().superRefine((value, ctx) => {
  if (!value.job_url && !value.job_url_direct) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Either job_url or job_url_direct is required.',
      path: ['job_url'],
    });
  }
});

export const jobCompensationPackSchema = z.object({
  salary_source: z.string().min(1).optional(),
  interval: z.string().min(1).optional(),
  min_amount: z.number().nonnegative().optional(),
  max_amount: z.number().nonnegative().optional(),
  currency: z.string().min(1).optional(),
}).strict();

export const jobWorkplacePackSchema = z.object({
  is_remote: z.boolean().optional(),
  work_from_home_type: z.string().min(1).optional(),
  location_text: z.string().min(1),
}).strict();

export const jobCompanyPackSchema = z.object({
  company_url: z.string().url().optional(),
  company_logo: z.string().url().optional(),
  company_industry: z.string().min(1).optional(),
  company_rating: z.number().nonnegative().optional(),
  company_reviews_count: z.number().int().nonnegative().optional(),
  company_description: z.string().optional(),
}).strict();

export const jobRequirementsPackSchema = z.object({
  skills: z.string().optional(),
  experience_range: z.string().min(1).optional(),
  job_level: z.string().min(1).optional(),
  job_function: z.string().min(1).optional(),
  job_type: z.string().min(1).optional(),
}).strict();

export const jobPackValidators: Record<string, z.ZodTypeAny> = {
  [JOB_POSTING_PACK_ID]: jobPostingPackSchema,
  [JOB_COMPENSATION_PACK_ID]: jobCompensationPackSchema,
  [JOB_WORKPLACE_PACK_ID]: jobWorkplacePackSchema,
  [JOB_COMPANY_PACK_ID]: jobCompanyPackSchema,
  [JOB_REQUIREMENTS_PACK_ID]: jobRequirementsPackSchema,
};
