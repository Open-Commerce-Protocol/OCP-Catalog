/**
 * WooCommerce REST API client. Mock mode reads from tests/fixtures/.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { WcProviderConfig } from '../config';
import type { WcProduct, WcSite, WcVariation } from './types';

const FIXTURE_BASE = new URL('../../tests/fixtures/', import.meta.url);

let _productsCache: WcProduct[] | null = null;
let _siteCache: WcSite | null = null;
let _variationsCache: Record<number, WcVariation[]> | null = null;

async function readFixture<T>(name: string): Promise<T> {
  const url = new URL(name, FIXTURE_BASE);
  const text = await readFile(fileURLToPath(url), 'utf-8');
  return JSON.parse(text) as T;
}

async function loadProductsFixture(): Promise<WcProduct[]> {
  if (!_productsCache) _productsCache = await readFixture<WcProduct[]>('wc-products.json');
  return _productsCache;
}

async function loadVariationsFixture(): Promise<Record<number, WcVariation[]>> {
  if (!_variationsCache) _variationsCache = await readFixture<Record<number, WcVariation[]>>('wc-variations.json');
  return _variationsCache;
}

async function loadSiteFixture(): Promise<WcSite> {
  if (!_siteCache) _siteCache = await readFixture<WcSite>('wc-site.json');
  return _siteCache;
}

export class WcApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly details?: unknown) {
    super(message);
    this.name = 'WcApiError';
  }
}

export interface ListProductsOptions {
  page?: number;
  perPage?: number;
  modifiedAfter?: string | null;
}

export class WcRestClient {
  constructor(private readonly cfg: WcProviderConfig) {}

  async siteProfile(): Promise<WcSite> {
    if (this.cfg.WC_PROVIDER_MOCK) return loadSiteFixture();
    // WooCommerce doesn't expose an authenticated /site endpoint; we use
    // /system_status which works with consumer keys, but that requires
    // privileged scopes. The reference fallback is to read the configured
    // SITE_URL + DEFAULT_CURRENCY, which is set by the operator.
    return {
      name: new URL(this.cfg.WC_PROVIDER_SITE_URL!).host,
      url: this.cfg.WC_PROVIDER_SITE_URL!,
      default_currency: this.cfg.WC_PROVIDER_DEFAULT_CURRENCY,
    };
  }

  async listProducts(opts: ListProductsOptions = {}): Promise<WcProduct[]> {
    if (this.cfg.WC_PROVIDER_MOCK) {
      const all = await loadProductsFixture();
      if (opts.modifiedAfter) {
        return all.filter((p) => (p.date_modified_gmt ?? '') > opts.modifiedAfter!);
      }
      return all;
    }
    const params = new URLSearchParams();
    params.set('page', String(opts.page ?? 1));
    params.set('per_page', String(opts.perPage ?? this.cfg.WC_PROVIDER_PAGE_SIZE));
    if (opts.modifiedAfter) params.set('modified_after', opts.modifiedAfter);
    return this.get<WcProduct[]>('products', params);
  }

  async getProduct(productId: number | string): Promise<WcProduct | null> {
    if (this.cfg.WC_PROVIDER_MOCK) {
      const all = await loadProductsFixture();
      return all.find((p) => p.id === Number(productId)) ?? null;
    }
    try {
      return await this.get<WcProduct>(`products/${productId}`);
    } catch (err) {
      if (err instanceof WcApiError && err.status === 404) return null;
      throw err;
    }
  }

  async listVariations(productId: number | string): Promise<WcVariation[]> {
    if (this.cfg.WC_PROVIDER_MOCK) {
      const all = await loadVariationsFixture();
      return all[Number(productId)] ?? [];
    }
    return this.get<WcVariation[]>(`products/${productId}/variations`, new URLSearchParams({ per_page: '100' }));
  }

  private async get<T>(path: string, params?: URLSearchParams): Promise<T> {
    if (!this.cfg.WC_PROVIDER_SITE_URL) {
      throw new WcApiError(0, 'WC_PROVIDER_SITE_URL is not set');
    }
    const base = this.cfg.WC_PROVIDER_SITE_URL.replace(/\/$/, '');
    const url = new URL(`${base}/wp-json/${this.cfg.WC_PROVIDER_API_VERSION}/${path}`);
    if (params) {
      for (const [k, v] of params.entries()) url.searchParams.set(k, v);
    }

    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.cfg.WC_PROVIDER_AUTH_MODE === 'basic') {
      const token = btoa(`${this.cfg.WC_PROVIDER_CONSUMER_KEY}:${this.cfg.WC_PROVIDER_CONSUMER_SECRET}`);
      headers.authorization = `Basic ${token}`;
    } else {
      url.searchParams.set('consumer_key', this.cfg.WC_PROVIDER_CONSUMER_KEY!);
      url.searchParams.set('consumer_secret', this.cfg.WC_PROVIDER_CONSUMER_SECRET!);
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(this.cfg.WC_PROVIDER_REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new WcApiError(0, `WC transport error: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!res.ok) {
      const snippet = (await res.text()).slice(0, 500);
      throw new WcApiError(res.status, `WC ${path} → ${res.status} ${res.statusText}: ${snippet}`);
    }
    return (await res.json()) as T;
  }
}
