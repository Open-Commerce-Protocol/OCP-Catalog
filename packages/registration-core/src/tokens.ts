import { createHash, randomBytes } from 'node:crypto';

export function issueCatalogToken() {
  return `oct_${randomBytes(32).toString('base64url')}`;
}

export function hashCatalogToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function verifyCatalogToken(token: string | undefined | null, expectedHash: string | null | undefined) {
  if (!token || !expectedHash) return false;
  const receivedHash = hashCatalogToken(token);
  return safeEqual(receivedHash, expectedHash);
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}
