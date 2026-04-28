import { McpToolError, type McpGatewayErrorCode } from '../errors';

export async function fetchJson<T>(
  url: string,
  init: RequestInit,
  options: {
    timeoutMs: number;
    unavailableCode: McpGatewayErrorCode;
    userAgent?: string;
  },
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const headers = new Headers(init.headers);
    if (options.userAgent) headers.set('user-agent', options.userAgent);

    const response = await fetch(url, {
      ...init,
      headers,
      signal: controller.signal,
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;

    if (!response.ok) {
      throw new McpToolError(options.unavailableCode, `HTTP ${response.status} from ${url}`, {
        url,
        status: response.status,
        payload,
      });
    }

    return payload as T;
  } catch (error) {
    if (error instanceof McpToolError) throw error;
    throw new McpToolError(options.unavailableCode, `Failed to fetch ${url}`, {
      url,
      cause: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearTimeout(timeout);
  }
}
