import { AppError } from '@ocp-catalog/shared';
import { resolveTxt } from 'node:dns/promises';

export type StoredChallenge = {
  challenge_id: string;
  challenge_type: 'dns_txt' | 'https_well_known';
  domain: string;
  name?: string;
  value?: string;
  url?: string;
  token?: string;
  expires_at: string;
};

export async function verifyChallenge(challenge: StoredChallenge, expectedCatalogId: string, expectedCenterId: string) {
  if (new Date(challenge.expires_at).getTime() < Date.now()) {
    return { ok: false as const, reason: 'challenge_expired' };
  }

  if (challenge.challenge_type === 'dns_txt') {
    return verifyDnsTxtChallenge(challenge);
  }

  if (challenge.challenge_type === 'https_well_known') {
    return verifyHttpsWellKnownChallenge(challenge, expectedCatalogId, expectedCenterId);
  }

  return { ok: false as const, reason: 'unsupported_challenge_type' };
}

async function verifyDnsTxtChallenge(challenge: StoredChallenge) {
  if (!challenge.name || !challenge.value) return { ok: false as const, reason: 'invalid_dns_challenge' };

  try {
    const records = await resolveTxt(challenge.name);
    const values = records.map((record) => record.join(''));
    return values.includes(challenge.value)
      ? { ok: true as const, domain: challenge.domain }
      : { ok: false as const, reason: 'dns_txt_value_not_found' };
  } catch (error) {
    return {
      ok: false as const,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function verifyHttpsWellKnownChallenge(
  challenge: StoredChallenge,
  expectedCatalogId: string,
  expectedCenterId: string,
) {
  if (!challenge.url || !challenge.token) return { ok: false as const, reason: 'invalid_https_challenge' };

  let response: Response;
  try {
    response = await fetch(challenge.url, { headers: { accept: 'application/json' } });
  } catch (error) {
    return {
      ok: false as const,
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  if (!response.ok) return { ok: false as const, reason: `${response.status} ${response.statusText}` };

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AppError('validation_error', 'HTTPS verification response is not JSON', 400);
  }

  if (!isRecord(payload)) return { ok: false as const, reason: 'https_challenge_response_not_object' };

  const matches = payload.center_id === expectedCenterId &&
    payload.catalog_id === expectedCatalogId &&
    payload.token === challenge.token;

  return matches
    ? { ok: true as const, domain: challenge.domain }
    : { ok: false as const, reason: 'https_challenge_payload_mismatch' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
