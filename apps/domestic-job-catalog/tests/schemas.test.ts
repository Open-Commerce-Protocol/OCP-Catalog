import { describe, expect, test } from "bun:test";
import { catalogQueryRequestSchema, domesticJobInputSchema } from "../src/schemas";

describe("strict schema", () => {
  test("rejects unknown query fields", () => {
    const result = catalogQueryRequestSchema.safeParse({
      query_pack: "ocp.job.domestic.filter.v1",
      filters: {},
      unexpected: true,
    });
    expect(result.success).toBe(false);
  });

  test("rejects unclassified active jobs", () => {
    const result = domesticJobInputSchema.safeParse({
      provider_id: "provider",
      external_job_id: "1",
      title: "后端工程师",
      company: "Example",
      description: "Java backend",
      apply_url: "https://example.com/apply/1",
      source_platform: "example",
      job_status: "active",
      fetched_at: new Date().toISOString(),
      city: "上海",
      recruitment_type: "social",
      matching_mode: "computer",
      classification_status: "unclassified",
      job_family: "backend",
      skills: [{ name: "Java" }],
      experiences: [{ name: "后端研发" }],
      evidence: ["title"],
    });
    expect(result.success).toBe(false);
  });

  test("computer jobs require skill and experience signals", () => {
    const result = domesticJobInputSchema.safeParse({
      provider_id: "provider",
      external_job_id: "1",
      title: "后端工程师",
      company: "Example",
      description: "Java backend",
      apply_url: "https://example.com/apply/1",
      source_platform: "example",
      job_status: "active",
      fetched_at: new Date().toISOString(),
      city: "上海",
      recruitment_type: "social",
      matching_mode: "computer",
      job_family: "backend",
      evidence: ["title"],
    });
    expect(result.success).toBe(false);
  });
});
