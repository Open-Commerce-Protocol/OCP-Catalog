import type { AppConfig } from '@ocp-catalog/config';
import { AppError } from '@ocp-catalog/shared';

export type CatalogProviderState = {
  provider_id: string;
  catalog_id: string;
  status: string;
  active_registration_version: number;
  declared_packs: string[];
  guaranteed_fields: string[];
  registration: Record<string, unknown> | null;
  catalog_quality?: {
    object_count: number;
    active_entry_count: number;
    rich_entry_count: number;
    standard_entry_count: number;
    basic_entry_count: number;
    out_of_stock_count: number;
    missing_image_count: number;
    missing_product_url_count: number;
  };
  updated_at: string;
};

export class CatalogClient {
  private readonly catalogBaseUrl: string;

  constructor(private readonly config: AppConfig) {
    this.catalogBaseUrl = config.CATALOG_PUBLIC_BASE_URL.replace(/\/$/, '');
  }

  registerProvider(registration: Record<string, unknown>) {
    return this.post('/ocp/providers/register', registration, { includeApiKey: false });
  }

  getProvider(providerId: string) {
    return this.request<CatalogProviderState>(`/ocp/providers/${providerId}`, {
      method: 'GET',
    });
  }

  syncObjects(request: Record<string, unknown>) {
    return this.post('/ocp/objects/sync', request, { includeApiKey: true });
  }

  private async post(path: string, body: unknown, options: { includeApiKey?: boolean } = {}) {
    return this.request<Record<string, unknown>>(path, {
      method: 'POST',
      body,
      includeApiKey: options.includeApiKey,
    });
  }

  private async request<T>(path: string, options: { method: 'GET' | 'POST'; body?: unknown; includeApiKey?: boolean }) {
    const response = await fetch(`${this.catalogBaseUrl}${path}`, {
      method: options.method,
      headers: {
        ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(options.includeApiKey ? { 'x-api-key': this.config.API_KEY_DEV } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new AppError(
        response.status === 404 ? 'not_found' : 'validation_error',
        `Catalog request failed: ${response.status} ${response.statusText}`,
        response.status,
        payload,
      );
    }

    return payload as T;
  }
}
