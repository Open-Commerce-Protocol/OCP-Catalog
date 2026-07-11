import { HttpError } from "./errors";
import { newId, nowIso } from "./ids";
import type { JobRepository } from "./storage/postgres";

export class ResolveService {
  constructor(
    private readonly jobs: JobRepository,
    private readonly catalogId: string,
  ) {}

  async resolve(input: unknown) {
    const request = parseResolveRequest(input);
    const row = await this.jobs.getById(request.entry_id);
    if (!row) throw new HttpError("not_found", `Entry not found: ${request.entry_id}`, 404);
    const now = nowIso();
    return {
      ocp_version: "1.0",
      kind: "ResolveResult",
      id: newId("resolve"),
      catalog_id: this.catalogId,
      resolved_at: now,
      reference: {
        kind: "ResolvableReference",
        catalog_id: this.catalogId,
        entry_id: row.id,
        object_id: row.external_job_id,
        object_type: "domestic_job",
        title: row.title,
        visible_attributes: {
          title: row.title,
          company: row.company,
          city: row.city,
          province: row.province,
          district: row.district,
          description: row.description,
          recruitment_type: row.recruitment_type,
          matching_mode: row.matching_mode,
          job_family: row.job_family,
          salary_min: row.salary_min,
          salary_max: row.salary_max,
          currency: row.currency,
          skills: row.skills,
          experiences: row.experiences,
          source_platform: row.source_platform,
        },
        action_bindings: [
          {
            action_id: "open_job",
            action_type: "url",
            label: "Open job",
            description: "Open the source job or apply page.",
            entrypoint: {
              url: row.apply_url,
              method: "GET",
            },
            auth_requirements: {},
            requires_user_confirmation: false,
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          },
        ],
        access: {
          visibility: "public",
          permission_state: "granted",
          redacted_fields: ["apply_url", "source_url"],
          policy_notes: ["Apply URL is exposed through action_bindings, not visible_attributes."],
        },
        live_checks: [
          {
            check_id: "apply_url_present",
            status: row.apply_url ? "passed" : "failed",
            checked_at: now,
            summary: row.apply_url ? "Apply URL is present." : "Apply URL is missing.",
            details: {},
          },
        ],
      },
    };
  }
}

function parseResolveRequest(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError("validation_error", "Resolve request must be an object.", 400);
  }
  const record = input as Record<string, unknown>;
  const entryId = record.entry_id
    ?? (record.entry && typeof record.entry === "object" && !Array.isArray(record.entry)
      ? (record.entry as Record<string, unknown>).entry_id
      : undefined);
  if (typeof entryId !== "string" || !entryId.trim()) {
    throw new HttpError("validation_error", "entry_id is required.", 400);
  }
  return { entry_id: entryId };
}
