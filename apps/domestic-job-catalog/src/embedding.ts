import type { AppConfig } from "./config";
import { HttpError } from "./errors";
import type { CandidateProfile } from "./schemas";
import type { JobRow } from "./storage/postgres";

export type EmbeddingResult = {
  vector: number[];
  model: string;
  dimension: number;
};

export class EmbeddingProvider {
  constructor(private readonly config: AppConfig["embedding"]) {}

  assertEnabled() {
    if (!this.config.enabled || !this.config.apiKey) {
      throw new HttpError("embedding_provider_disabled", "Embedding provider is not configured for this catalog.", 503);
    }
  }

  async embed(text: string): Promise<EmbeddingResult> {
    this.assertEnabled();
    const normalized = text.trim();
    if (!normalized) throw new HttpError("embedding_input_empty", "Embedding input text is empty.", 400);
    const response = await fetch(`${this.config.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        input: normalized,
        dimensions: this.config.dimension,
      }),
    });
    if (!response.ok) {
      throw new HttpError("embedding_provider_error", `Embedding provider returned HTTP ${response.status}`, 503, {
        status: response.status,
        statusText: response.statusText,
      });
    }
    const payload = await response.json() as {
      data?: Array<{ embedding?: number[] }>;
      model?: string;
    };
    const vector = payload.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length === 0) {
      throw new HttpError("embedding_response_invalid", "Embedding provider response did not include a vector.", 503);
    }
    if (vector.length !== this.config.dimension) {
      throw new HttpError("embedding_dimension_mismatch", `Embedding dimension ${vector.length} does not match configured ${this.config.dimension}.`, 503, {
        actual: vector.length,
        expected: this.config.dimension,
      });
    }
    if (vector.every((value) => value === 0)) {
      throw new HttpError("embedding_zero_vector", "Embedding provider returned a zero vector.", 503);
    }
    return {
      vector,
      model: payload.model ?? this.config.model,
      dimension: vector.length,
    };
  }
}

export function buildJobEmbeddingText(job: JobRow | {
  title: string;
  company: string;
  city: string;
  description: string;
  job_family: string;
  recruitment_type: string;
  skills: Array<Record<string, unknown>>;
  experiences: Array<Record<string, unknown>>;
  tags: Array<Record<string, unknown>>;
  responsibilities: string[];
  highlights: string[];
}) {
  return [
    `title: ${job.title}`,
    `company: ${job.company}`,
    `city: ${job.city}`,
    `job_family: ${job.job_family}`,
    `recruitment_type: ${job.recruitment_type}`,
    `skills: ${names(job.skills).join(", ")}`,
    `experiences: ${names(job.experiences).join(", ")}`,
    `tags: ${names(job.tags).join(", ")}`,
    `responsibilities: ${job.responsibilities.join(" ")}`,
    `highlights: ${job.highlights.join(" ")}`,
    `description: ${job.description}`,
  ].filter(Boolean).join("\n");
}

export function buildCandidateEmbeddingText(profile: CandidateProfile) {
  const workText = profile.work_experiences.map((item) => [
    item.title,
    item.company_name,
    item.industry,
    item.description,
    ...item.responsibilities,
    ...item.achievements,
    ...item.tech_stack,
  ].filter(Boolean).join(" ")).join("\n");
  const projectText = profile.projects.map((item) => [
    item.name,
    item.role,
    item.domain,
    item.description,
    ...item.responsibilities,
    ...item.achievements,
    ...item.tech_stack,
  ].filter(Boolean).join(" ")).join("\n");
  return [
    profile.basic_info.summary,
    profile.basic_info.current_title,
    `work_years: ${profile.basic_info.work_years ?? ""}`,
    `target cities: ${profile.target.cities.join(", ")}`,
    `target job families: ${profile.target.job_families.join(", ")}`,
    `skills: ${profile.skills.map((item) => item.name).join(", ")}`,
    `tags: ${profile.tags.map((item) => item.name).join(", ")}`,
    workText,
    projectText,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0).join("\n");
}

function names(items: Array<Record<string, unknown>>) {
  return items
    .map((item) => typeof item.name === "string" ? item.name : undefined)
    .filter((value): value is string => Boolean(value));
}
