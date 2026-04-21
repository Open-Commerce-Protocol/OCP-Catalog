import type { AppConfig } from '@ocp-catalog/config';
import { schema } from '@ocp-catalog/db';
import type { CommercialObject } from '@ocp-catalog/ocp-schema';

type ProviderProduct = typeof schema.providerProducts.$inferSelect;

export function buildProviderRegistration(config: AppConfig, registrationVersion: number) {
  return {
    ocp_version: '1.0',
    kind: 'ProviderRegistration',
    id: `reg_${config.COMMERCE_PROVIDER_ID}_${registrationVersion}`,
    catalog_id: config.CATALOG_ID,
    registration_version: registrationVersion,
    updated_at: new Date().toISOString(),
    provider: {
      provider_id: config.COMMERCE_PROVIDER_ID,
      entity_type: 'merchant',
      display_name: config.COMMERCE_PROVIDER_NAME,
      homepage: config.PROVIDER_PUBLIC_BASE_URL,
      contact_email: config.COMMERCE_PROVIDER_CONTACT_EMAIL,
      domains: [config.COMMERCE_PROVIDER_DOMAIN],
    },
    object_declarations: [
      {
        object_type: 'product',
        provided_packs: [
          'ocp.commerce.product.core.v1',
          'ocp.commerce.price.v1',
          'ocp.commerce.inventory.v1',
        ],
        guaranteed_fields: ['ocp.commerce.product.core.v1#/title'],
        optional_fields: [
          'ocp.commerce.product.core.v1#/summary',
          'ocp.commerce.product.core.v1#/brand',
          'ocp.commerce.product.core.v1#/category',
          'ocp.commerce.product.core.v1#/product_url',
          'ocp.commerce.price.v1#/currency',
          'ocp.commerce.price.v1#/amount',
          'ocp.commerce.inventory.v1#/availability_status',
        ],
        delivery: { mode: 'push_api' },
      },
    ],
  };
}

export function buildObjectSyncRequest(
  config: AppConfig,
  registrationVersion: number,
  products: ProviderProduct[],
  options?: { batchId?: string; now?: number },
) {
  const batchId = options?.batchId ?? `provider_batch_${options?.now ?? Date.now()}`;
  return {
    ocp_version: '1.0',
    kind: 'ObjectSyncRequest',
    catalog_id: config.CATALOG_ID,
    provider_id: config.COMMERCE_PROVIDER_ID,
    registration_version: registrationVersion,
    batch_id: batchId,
    objects: products.map((product) => mapProductToCommercialObject(config, product)),
  };
}

export function mapProductToCommercialObject(config: AppConfig, product: ProviderProduct): CommercialObject {
  return {
    ocp_version: '1.0',
    kind: 'CommercialObject',
    id: `obj_${config.COMMERCE_PROVIDER_ID}_${product.sku}`,
    object_id: product.sku,
    object_type: 'product',
    provider_id: config.COMMERCE_PROVIDER_ID,
    title: product.title,
    summary: product.summary,
    status: product.status === 'active' && product.availabilityStatus !== 'out_of_stock' ? 'active' : 'inactive',
    source_url: product.productUrl,
    descriptors: [
      {
        pack_id: 'ocp.commerce.product.core.v1',
        data: {
          title: product.title,
          summary: product.summary,
          brand: product.brand,
          category: product.category,
          sku: product.sku,
          product_url: product.productUrl,
          image_urls: product.imageUrls,
          attributes: product.attributes,
        },
      },
      {
        pack_id: 'ocp.commerce.price.v1',
        data: {
          currency: product.currency,
          amount: product.amount / 100,
          price_type: 'fixed',
        },
      },
      {
        pack_id: 'ocp.commerce.inventory.v1',
        data: {
          availability_status: product.availabilityStatus,
          quantity: product.quantity,
        },
      },
    ],
  };
}
