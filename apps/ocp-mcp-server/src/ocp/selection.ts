import { McpToolError } from '../errors';

export type CatalogCandidate = {
  catalog_id: string;
  health_status?: string | null;
  verification_status?: string | null;
  trust_tier?: string | null;
  language_match?: boolean;
  domain_match?: boolean;
};

export function selectBestCatalog<T extends CatalogCandidate>(candidates: T[]) {
  if (candidates.length === 0) {
    throw new McpToolError('catalog_not_found', 'no catalogs matched the search request');
  }

  return [...candidates]
    .map((candidate, index) => ({ candidate, index, score: scoreCatalog(candidate) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)[0]!.candidate;
}

function scoreCatalog(candidate: CatalogCandidate) {
  let score = 0;
  if (candidate.health_status === 'healthy') score += 100;
  if (candidate.health_status === 'unknown') score += 25;
  if (candidate.verification_status === 'verified' || candidate.verification_status === 'not_required') score += 50;
  if (candidate.trust_tier === 'trusted' || candidate.trust_tier === 'standard') score += 10;
  if (candidate.language_match === true) score += 25;
  if (candidate.domain_match === true) score += 25;
  return score;
}
