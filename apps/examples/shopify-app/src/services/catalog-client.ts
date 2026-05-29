import type { ShopifyAppConfig } from '../config';

export class CatalogClientError extends Error {
  constructor(public readonly status: number, message: string, public readonly details?: unknown) {
    super(message);
    this.name = 'CatalogClientError';
  }
}

export interface CatalogProviderState {
  provider_id: string;
  catalog_id: string;
  status: string;
  active_registration_version: number;
}

export class CatalogClient {
  private readonly baseUrl: string;
  constructor(private readonly cfg: ShopifyAppConfig) {
    this.baseUrl = cfg.SHOPIFY_APP_CATALOG_BASE_URL.replace(/\/$/, '');
  }

  registerProvider(registration: Record<string, unknown>) {
    return this.request<Record<string, unknown>>('/ocp/providers/register', { method: 'POST', body: registration });
  }

  syncObjects(request: Record<string, unknown>) {
    return this.request<Record<string, unknown>>('/ocp/objects/sync', { method: 'POST', body: request, includeApiKey: true });
  }

  deactivateProvider(providerId: string) {
    return this.request<Record<string, unknown>>(`/ocp/providers/${encodeURIComponent(providerId)}/deactivate`, {
      method: 'POST',
      body: {},
      includeApiKey: true,
    });
  }

  eraseProvider(providerId: string) {
    return this.request<Record<string, unknown>>(`/ocp/providers/${encodeURIComponent(providerId)}/erase`, {
      method: 'POST',
      body: {},
      includeApiKey: true,
    });
  }

  async getProvider(providerId: string): Promise<CatalogProviderState | null> {
    try {
      return await this.request<CatalogProviderState>(`/ocp/providers/${providerId}`, { method: 'GET' });
    } catch (err) {
      if (err instanceof CatalogClientError && err.status === 404) return null;
      throw err;
    }
  }

  private async request<T>(path: string, opts: { method: 'GET' | 'POST'; body?: unknown; includeApiKey?: boolean }): Promise<T> {
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (opts.includeApiKey) headers['x-api-key'] = this.cfg.SHOPIFY_APP_CATALOG_API_KEY;
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: opts.method,
      headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
    const text = await res.text();
    let payload: any = text;
    try { payload = text ? JSON.parse(text) : null; } catch { /* keep text */ }
    if (!res.ok) {
      throw new CatalogClientError(res.status, `Catalog ${opts.method} ${path} → ${res.status} ${res.statusText}`, payload);
    }
    return payload as T;
  }
}
