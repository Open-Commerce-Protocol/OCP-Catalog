export function firstHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function statusCode(value: unknown) {
  return typeof value === 'number' ? value : 200;
}

export function logRequest(input: {
  request: Request;
  pathname?: string;
  status: number;
  durationMs?: number;
  error?: unknown;
}) {
  const level = input.status >= 500 ? 'error' : input.status >= 400 ? 'warn' : 'info';
  const logLine = {
    ts: new Date().toISOString(),
    level,
    event: 'http_request',
    method: input.request.method,
    path: input.pathname ?? new URL(input.request.url).pathname,
    status: input.status,
    duration_ms: input.durationMs !== undefined ? Number(input.durationMs.toFixed(2)) : undefined,
    user_agent: input.request.headers.get('user-agent') ?? undefined,
    error: input.error instanceof Error ? input.error.message : undefined,
  };

  const writer = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  writer(JSON.stringify(logLine));
}
