import type { CandidateProfile } from "../schemas";
import type { JobRow } from "../storage/postgres";
import { fuzzyContains, phraseCoverage, termSet } from "./terms";

export type ScoreBreakdown = {
  algorithm_version: "domestic_job_match_v1";
  vector_similarity: number;
  skill_match: number;
  experience_match: number;
  education_match: number;
  stage_fit: number;
  active_dimensions: string[];
  inactive_dimensions: Array<{ dimension: string; reason: string }>;
  total: number;
};

export function scoreJobMatch(job: JobRow, profile: CandidateProfile, vectorScore: number): ScoreBreakdown {
  if (job.matching_mode !== "computer") {
    throw new Error(`Cannot structured-rerank matching_mode=${job.matching_mode}`);
  }
  const dimensions: Array<{ name: string; score: number; weight: number; active: boolean; inactiveReason?: string }> = [
    { name: "vector", score: vectorScore, weight: 0.20, active: true },
    dimension("skill", scoreSkills(job, profile), 0.25),
    dimension("experience", scoreExperience(job, profile), 0.25),
    dimension("education", scoreEducation(job, profile), 0.10),
    dimension("stage_fit", scoreStageFit(job, profile), 0.20),
  ];
  const active = dimensions.filter((item) => item.active);
  if (active.length === 0) {
    throw new Error(`No active score dimensions for job ${job.id}`);
  }
  const weightSum = active.reduce((sum, item) => sum + item.weight, 0);
  const total = active.reduce((sum, item) => sum + clamp01(item.score) * item.weight, 0) / weightSum;
  return {
    algorithm_version: "domestic_job_match_v1",
    vector_similarity: round4(vectorScore),
    skill_match: round4(dimensions.find((item) => item.name === "skill")?.score ?? 0),
    experience_match: round4(dimensions.find((item) => item.name === "experience")?.score ?? 0),
    education_match: round4(dimensions.find((item) => item.name === "education")?.score ?? 0),
    stage_fit: round4(dimensions.find((item) => item.name === "stage_fit")?.score ?? 0),
    active_dimensions: active.map((item) => item.name),
    inactive_dimensions: dimensions
      .filter((item) => !item.active)
      .map((item) => ({ dimension: item.name, reason: item.inactiveReason ?? "no_signal" })),
    total: round4(total),
  };
}

export function vectorScoreFromOpenSearch(score: number) {
  if (!Number.isFinite(score)) return 0;
  return clamp01(score);
}

function dimension(
  name: string,
  result: { score: number; active: boolean; inactiveReason?: string },
  weight: number,
) {
  const item: { name: string; score: number; weight: number; active: boolean; inactiveReason?: string } = {
    name,
    score: result.score,
    weight,
    active: result.active,
  };
  if (result.inactiveReason) item.inactiveReason = result.inactiveReason;
  return item;
}

function scoreSkills(job: JobRow, profile: CandidateProfile) {
  const requirements = job.skills
    .map((item) => ({
      name: stringValue(item.name),
      type: stringValue(item.requirement_type) ?? "required",
      weight: numberValue(item.weight) ?? 1,
    }))
    .filter((item): item is { name: string; type: string; weight: number } => Boolean(item.name));
  if (requirements.length === 0) return inactive("job has no structured skill requirements");
  const candidateTerms = termSet([
    ...profile.skills.map((item) => item.name),
    ...profile.tags.map((item) => item.name),
    ...profile.work_experiences.flatMap((item) => [item.title, ...item.tech_stack]),
    ...profile.projects.flatMap((item) => [item.name, item.role ?? "", item.domain ?? "", ...item.tech_stack]),
  ]);
  if (candidateTerms.size === 0) return inactive("candidate has no skill terms");
  let weighted = 0;
  let weightSum = 0;
  for (const requirement of requirements) {
    const hit = fuzzyContains(candidateTerms, requirement.name) ? 1 : 0;
    const multiplier = requirement.type === "required" ? 2 : requirement.type === "bonus" ? 0.75 : 1;
    const weight = requirement.weight * multiplier;
    weighted += hit * weight;
    weightSum += weight;
  }
  return active(weightSum === 0 ? 0 : weighted / weightSum);
}

function scoreExperience(job: JobRow, profile: CandidateProfile) {
  const requirements = job.experiences
    .map((item) => stringValue(item.name))
    .filter((value): value is string => Boolean(value));
  if (requirements.length === 0) return inactive("job has no structured experience requirements");
  const candidateTerms = termSet([
    ...profile.work_experiences.flatMap((item) => [
      item.title,
      item.company_name ?? "",
      item.industry ?? "",
      item.description ?? "",
      ...item.responsibilities,
      ...item.achievements,
      ...item.tech_stack,
    ]),
    ...profile.projects.flatMap((item) => [
      item.name,
      item.role ?? "",
      item.domain ?? "",
      item.description ?? "",
      ...item.responsibilities,
      ...item.achievements,
      ...item.tech_stack,
    ]),
  ]);
  if (candidateTerms.size === 0) return inactive("candidate has no experience terms");
  return active(phraseCoverage(requirements, candidateTerms).score);
}

function scoreEducation(job: JobRow, profile: CandidateProfile) {
  const education = job.education;
  const minDegree = stringValue(education.min_degree);
  const requiredMajors = arrayOfStrings(education.required_majors);
  const preferredMajors = arrayOfStrings(education.preferred_majors);
  if (!minDegree && requiredMajors.length === 0 && preferredMajors.length === 0) {
    return inactive("job has no education constraints");
  }
  const candidateDegree = profile.basic_info.highest_degree
    ?? profile.educations.map((item) => item.degree).find((value): value is string => Boolean(value));
  const degreeScore = minDegree ? (degreeRank(candidateDegree) >= degreeRank(minDegree) ? 1 : 0) : 0.5;
  const candidateMajorTerms = termSet(profile.educations.map((item) => item.major ?? ""));
  const majorScore = requiredMajors.length > 0
    ? phraseCoverage(requiredMajors, candidateMajorTerms).score
    : preferredMajors.length > 0
      ? phraseCoverage(preferredMajors, candidateMajorTerms).score
      : 0.5;
  return active((degreeScore * 0.7) + (majorScore * 0.3));
}

function scoreStageFit(job: JobRow, profile: CandidateProfile) {
  const stage = candidateStage(profile);
  const table: Record<string, number> = {
    "student:internship": 1,
    "student:campus": 1,
    "student:social": 0.3,
    "fresh:internship": 0.9,
    "fresh:campus": 1,
    "fresh:social": 0.45,
    "junior:internship": 0.2,
    "junior:campus": 0.4,
    "junior:social": 1,
    "mid:internship": 0,
    "mid:campus": 0.1,
    "mid:social": 1,
    "senior:internship": 0,
    "senior:campus": 0,
    "senior:social": 1,
  };
  return active(table[`${stage}:${job.recruitment_type}`] ?? 0.5);
}

function candidateStage(profile: CandidateProfile) {
  const years = profile.basic_info.work_years;
  const title = profile.basic_info.current_title ?? "";
  if (title.includes("实习") || title.includes("在读")) return "student";
  if (years === undefined || years <= 1) return "fresh";
  if (years <= 3) return "junior";
  if (years <= 8) return "mid";
  return "senior";
}

function degreeRank(value: unknown) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  switch (normalized) {
    case "博士":
    case "phd":
    case "doctor":
      return 5;
    case "硕士":
    case "研究生":
    case "master":
    case "mba":
      return 4;
    case "本科":
    case "学士":
    case "bachelor":
      return 3;
    case "大专":
    case "专科":
    case "associate":
      return 2;
    case "高中":
    case "中专":
      return 1;
    default:
      return 0;
  }
}

function active(score: number) {
  return { score: clamp01(score), active: true };
}

function inactive(reason: string) {
  return { score: 0, active: false, inactiveReason: reason };
}

function clamp01(value: number) {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function round4(value: number) {
  return Math.round(value * 10000) / 10000;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function arrayOfStrings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}
