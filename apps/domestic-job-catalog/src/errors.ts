export class HttpError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function requireEnv(name: string) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value.trim();
}

export function optionalEnv(name: string) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

export function parseBooleanEnv(name: string, defaultValue: boolean) {
  const value = optionalEnv(name);
  if (value === undefined) return defaultValue;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new Error(`${name} must be true/false or 1/0`);
}

export function parseIntegerEnv(name: string, defaultValue: number) {
  const value = optionalEnv(name);
  if (value === undefined) return defaultValue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function errorPayload(error: unknown) {
  if (error instanceof HttpError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    };
  }
  return {
    error: {
      code: "internal_error",
      message: "The service encountered an internal error.",
    },
  };
}
