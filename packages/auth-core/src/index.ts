import { AppError } from '@ocp-catalog/shared';

export function requireApiKey(received: string | null | undefined, expected: string, additionalKeys = '') {
  const allowed = [expected, ...additionalKeys.split(',').map((key) => key.trim())].filter(Boolean);
  if (!received || !allowed.some((key) => safeEqual(received, key))) {
    throw new AppError('unauthorized', 'Missing or invalid API key', 401);
  }
}

function safeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) return false;

  let diff = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    diff |= leftBytes[index]! ^ rightBytes[index]!;
  }
  return diff === 0;
}
