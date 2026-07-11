export function normalizeTerm(value: string) {
  return value.trim().toLowerCase();
}

export function termSet(values: string[]) {
  const result = new Set<string>();
  for (const value of values) {
    const normalized = normalizeTerm(value);
    if (!normalized) continue;
    result.add(normalized);
    for (const token of splitTokens(normalized)) result.add(token);
  }
  return result;
}

export function splitTokens(value: string) {
  return value.split(/[-_ ,;，、；/\n\t]+/g).map(normalizeTerm).filter(Boolean);
}

export function fuzzyContains(terms: Set<string>, value: string) {
  const normalized = normalizeTerm(value);
  if (!normalized) return false;
  if (terms.has(normalized)) return true;
  for (const alias of aliases(normalized)) {
    if (terms.has(alias)) return true;
  }
  const parts = splitTokens(normalized);
  if (parts.length > 1 && parts.every((part) => terms.has(part) || aliases(part).some((alias) => terms.has(alias)))) {
    return true;
  }
  for (const term of terms) {
    if (isCjk(normalized) && cjkPhraseMatch(term, normalized)) return true;
    if (splitTokens(term).includes(normalized)) return true;
  }
  return false;
}

export function phraseCoverage(phrases: string[], terms: Set<string>) {
  const normalized = [...new Set(phrases.map(normalizeTerm).filter(Boolean))];
  if (normalized.length === 0) return { score: 0, active: false as const };
  const hits = normalized.filter((phrase) => fuzzyContains(terms, phrase)).length;
  return { score: hits / normalized.length, active: true as const };
}

function aliases(value: string) {
  switch (value) {
    case "go":
    case "golang":
      return ["go", "golang"];
    case "js":
    case "javascript":
      return ["js", "javascript"];
    case "ts":
    case "typescript":
      return ["ts", "typescript"];
    case "ai":
    case "人工智能":
      return ["ai", "人工智能", "artificial intelligence"];
    default:
      return [];
  }
}

function isCjk(value: string) {
  return Array.from(value).some((ch) => /[\u4e00-\u9fff]/u.test(ch));
}

function cjkPhraseMatch(candidate: string, required: string) {
  if (candidate.includes(required)) return true;
  const common = longestCommonCjkRun(candidate, required);
  const requiredLength = Array.from(required).length;
  return common >= 3 && common / requiredLength >= 0.7;
}

function longestCommonCjkRun(a: string, b: string) {
  const ar = Array.from(a);
  const br = Array.from(b);
  let best = 0;
  const dp = new Array<number>(br.length + 1).fill(0);
  for (let i = 1; i <= ar.length; i++) {
    let prev = 0;
    for (let j = 1; j <= br.length; j++) {
      const tmp = dp[j] ?? 0;
      if (ar[i - 1] === br[j - 1] && /[\u4e00-\u9fff]/u.test(ar[i - 1] ?? "")) {
        dp[j] = prev + 1;
        best = Math.max(best, dp[j] ?? 0);
      } else {
        dp[j] = 0;
      }
      prev = tmp;
    }
  }
  return best;
}
