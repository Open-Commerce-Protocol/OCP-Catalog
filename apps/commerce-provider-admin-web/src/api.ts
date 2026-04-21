export type ProductStatus = 'active' | 'inactive' | 'draft';
export type AvailabilityStatus = 'in_stock' | 'low_stock' | 'out_of_stock' | 'preorder' | 'unknown';

export type ProductRecord = {
  id: string;
  providerId: string;
  sku: string;
  title: string;
  summary: string;
  brand: string;
  category: string;
  productUrl: string;
  imageUrls: string[];
  currency: string;
  amount: number;
  listAmount: number | null;
  priceType: 'fixed' | 'range';
  availabilityStatus: AvailabilityStatus;
  quantity: number;
  status: ProductStatus;
  attributes: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type ProductFormInput = {
  sku: string;
  title: string;
  summary: string;
  brand: string;
  category: string;
  product_url?: string;
  image_urls: string[];
  currency: string;
  amount: number;
  list_amount?: number;
  price_type: 'fixed' | 'range';
  availability_status: AvailabilityStatus;
  quantity: number;
  status: ProductStatus;
  attributes: Record<string, unknown>;
};

export type SyncRunRecord = {
  id: string;
  providerId: string;
  runType: string;
  targetProductId: string | null;
  registrationVersion: number | null;
  status: string;
  requestPayload: Record<string, unknown> | null;
  resultPayload: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
};

export type ProviderStatusRecord = {
  provider_id: string;
  catalog_id: string;
  status: string;
  active_registration_version: number | null;
  next_registration_version: number;
  sync_batch_size: number;
  local_quality: {
    product_count: number;
    ready_for_publish_count: number;
    missing_price_count: number;
    missing_list_price_count: number;
    missing_product_url_count: number;
    missing_image_count: number;
    missing_brand_or_category_count: number;
    out_of_stock_count: number;
    active_count: number;
  };
  publish_readiness: {
    ready: boolean;
    blocking_issues: string[];
    warnings: string[];
  };
  catalog_quality: {
    object_count: number;
    active_entry_count: number;
    rich_entry_count: number;
    standard_entry_count: number;
    basic_entry_count: number;
    out_of_stock_count: number;
    missing_image_count: number;
    missing_product_url_count: number;
  } | null;
};

const API_PREFIX = '/api/provider-admin';

export async function fetchProducts(apiKey: string) {
  const data = await request<{ provider_id: string; products: ProductRecord[] }>('/admin/products', {
    method: 'GET',
    apiKey,
  });
  return data.products;
}

export async function createProduct(apiKey: string, input: ProductFormInput) {
  return request<ProductRecord>('/admin/products', {
    method: 'POST',
    apiKey,
    body: input,
  });
}

export async function updateProduct(apiKey: string, id: string, input: Partial<ProductFormInput>) {
  return request<ProductRecord>(`/admin/products/${id}`, {
    method: 'PATCH',
    apiKey,
    body: input,
  });
}

export async function deactivateProduct(apiKey: string, id: string) {
  return request<ProductRecord>(`/admin/products/${id}`, {
    method: 'DELETE',
    apiKey,
  });
}

export async function seedDemoProducts(apiKey: string) {
  return request<{ provider_id: string; seeded_count: number; products: ProductRecord[] }>('/admin/products/seed-demo', {
    method: 'POST',
    apiKey,
  });
}

export async function registerToCatalog(apiKey: string, registrationVersion: number) {
  return request<SyncRunRecord>('/provider/register-to-catalog', {
    method: 'POST',
    apiKey,
    body: { registration_version: registrationVersion },
  });
}

export async function publishToCatalog(apiKey: string, registrationVersion: number) {
  return request<{
    provider_id: string;
    registration_version: number | null;
    status: string;
    register_run: SyncRunRecord;
    sync_run: SyncRunRecord | null;
  }>('/provider/publish-to-catalog', {
    method: 'POST',
    apiKey,
    body: { registration_version: registrationVersion },
  });
}

export async function syncAllProducts(apiKey: string, registrationVersion: number) {
  return request<SyncRunRecord>('/provider/sync-to-catalog', {
    method: 'POST',
    apiKey,
    body: { registration_version: registrationVersion },
  });
}

export async function syncOneProduct(apiKey: string, productId: string, registrationVersion: number) {
  return request<SyncRunRecord>(`/provider/sync-product/${productId}`, {
    method: 'POST',
    apiKey,
    body: { registration_version: registrationVersion },
  });
}

export async function fetchSyncRuns(apiKey: string) {
  const data = await request<{ provider_id: string; runs: SyncRunRecord[] }>('/provider/sync-runs', {
    method: 'GET',
    apiKey,
  });
  return data.runs;
}

export async function fetchProviderStatus(apiKey: string) {
  return request<ProviderStatusRecord>('/provider/status', {
    method: 'GET',
    apiKey,
  });
}

type RequestOptions = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  apiKey: string;
  body?: unknown;
};

async function request<T>(path: string, options: RequestOptions): Promise<T> {
  const response = await fetch(`${API_PREFIX}${path}`, {
    method: options.method,
    headers: {
      'content-type': 'application/json',
      'x-admin-key': options.apiKey,
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message ?? `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}
