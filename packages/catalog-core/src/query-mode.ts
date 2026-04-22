export function inferQueryMode(
  query: string,
  filters: Record<string, string | number | boolean | undefined>,
) {
  const hasQuery = tokenize(query).length > 0;
  const hasFilters = Object.values(filters).some(Boolean);
  if (hasQuery && hasFilters) return 'hybrid' as const;
  if (hasFilters) return 'filter' as const;
  return 'keyword' as const;
}

function tokenize(query: string) {
  return query
    .toLowerCase()
    .split(/[\s,]+/)
    .map((term) => term.trim())
    .filter(Boolean);
}
