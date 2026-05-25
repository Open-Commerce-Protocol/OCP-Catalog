import type { DemoCallRecord } from './webmcp/tools';
import type { CatalogQueryResponse } from './ocp-http';

export type ProductCard = {
  id: string;
  title: string;
  brand?: string;
  price?: string;
  availability?: string;
  imageUrl?: string;
  productUrl?: string;
  subtitle?: string;
};

export type CatalogSearchSummary = {
  title: string;
  catalogName?: string;
  catalogId?: string;
  products: ProductCard[];
  error?: string;
};

export function findLatestCatalogSummary(history: readonly DemoCallRecord[]) {
  for (const record of history) {
    const summary = summarizeCatalogCall(record);
    if (summary.products.length > 0 || summary.error) return summary;
  }
  return null;
}

export function summarizeCatalogResponse(response: CatalogQueryResponse, catalogName?: string): CatalogSearchSummary {
  const products = getEntryArray(response.entries).map(toProductCard);
  return {
    title: products.length > 0 ? `${products.length} 件商品` : '没有找到商品',
    catalogName,
    catalogId: response.catalog_id,
    products,
  };
}

export function summarizeCatalogCall(record: DemoCallRecord): CatalogSearchSummary {
  if (record.error) {
    return { title: record.toolName, products: [], error: record.error };
  }

  const result = record.result as { structuredContent?: Record<string, unknown> } | undefined;
  const content = result?.structuredContent;
  const error = content?.error as { message?: string } | undefined;
  if (error) {
    return { title: record.toolName, products: [], error: error.message ?? '查询失败' };
  }

  const selectedCatalog = isRecord(content?.selected_catalog) ? content.selected_catalog : undefined;
  const directCatalog = isRecord(content?.catalog) ? content.catalog : undefined;
  const queryResult = isRecord(content?.query_result) ? content.query_result : undefined;
  const entries = queryResult ? getEntryArray(queryResult.entries) : getEntryArray(content?.entries);
  const products = entries.map(toProductCard);

  return {
    title: products.length > 0 ? `${products.length} 件商品已上架` : '没有找到商品',
    catalogName: getString(selectedCatalog?.catalog_name) ?? getString(directCatalog?.catalog_name) ?? getString(content?.catalog_name),
    catalogId: getString(selectedCatalog?.catalog_id) ?? getString(directCatalog?.catalog_id) ?? getString(content?.catalog_id),
    products,
  };
}

function getEntryArray(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function toProductCard(entry: Record<string, unknown>, index: number): ProductCard {
  const match = isRecord(entry.entry) ? entry : undefined;
  const score = typeof match?.score === 'number' ? match.score : undefined;
  entry = match ? match.entry as Record<string, unknown> : entry;
  const attributes = isRecord(entry.attributes) ? entry.attributes : {};
  const title = getString(entry.title) ?? getString(attributes.name) ?? `Catalog item ${index + 1}`;
  return {
    id: getString(entry.id) ?? getString(entry.entry_id) ?? `${title}-${index}`,
    title,
    brand: getString(attributes.brand),
    price: formatPrice(attributes.amount, attributes.currency) ?? getString(attributes.price),
    availability: formatAvailability(getString(attributes.availability_status) ?? getString(attributes.availability)),
    imageUrl: getString(attributes.primary_image_url) ?? getString(attributes.image_url),
    productUrl: getString(attributes.product_url) ?? getString(attributes.url),
    subtitle: getString(attributes.category) ?? getString(attributes.description) ?? (score !== undefined ? `score ${score}` : undefined),
  };
}

function formatPrice(amount: unknown, currency: unknown) {
  if (typeof amount !== 'number' || typeof currency !== 'string') return undefined;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatAvailability(value?: string) {
  if (!value) return undefined;
  return value.replaceAll('_', ' ');
}

function getString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
