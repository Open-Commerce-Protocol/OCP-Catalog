import {
  inventoryPackSchema,
  pricePackSchema,
  productCorePackSchema,
  type ActionBinding,
  type CatalogManifest,
  type CommercialObject,
  type ObjectContract,
  type SyncCapability,
} from '@ocp-catalog/ocp-schema';
import {
  numberField,
  readDescriptorField,
  stringField,
  type CatalogScenarioModule,
  type ResolveContext,
  type SearchProjection,
} from '@ocp-catalog/catalog-core';
import type { z } from 'zod';

const packValidators: Record<string, z.ZodTypeAny> = {
  'ocp.commerce.product.core.v1': productCorePackSchema,
  'ocp.commerce.price.v1': pricePackSchema,
  'ocp.commerce.inventory.v1': inventoryPackSchema,
};

export function createCommerceCatalogScenario(options: { semanticSearchEnabled?: boolean } = {}): CatalogScenarioModule {
  return {
    description: 'Protocol-first OCP Commerce product Catalog node.',
    registryVisibility: 'public',
    objectContracts: buildCommerceObjectContracts,
    providerSyncCapabilities: buildCommerceSyncCapabilities,
    queryCapabilities: () => buildCommerceQueryCapabilities(options),
    validateDescriptorPack,
    buildSearchProjection,
    buildExplainProjection,
    buildEmbeddingText,
    buildResolveActions,
  };
}

function buildCommerceObjectContracts(): ObjectContract[] {
  return [
    {
      required_fields: [
        'ocp.commerce.product.core.v1#/title',
        'ocp.commerce.price.v1#/currency',
        'ocp.commerce.price.v1#/amount',
      ],
      optional_fields: [
        'ocp.commerce.product.core.v1#/summary',
        'ocp.commerce.product.core.v1#/brand',
        'ocp.commerce.product.core.v1#/category',
        'ocp.commerce.product.core.v1#/sku',
        'ocp.commerce.product.core.v1#/product_url',
        'ocp.commerce.product.core.v1#/image_urls',
        'ocp.commerce.price.v1#/currency',
        'ocp.commerce.price.v1#/amount',
        'ocp.commerce.inventory.v1#/availability_status',
        'ocp.commerce.inventory.v1#/quantity',
      ],
      additional_fields_policy: 'allow',
    },
  ];
}

function buildCommerceSyncCapabilities(): SyncCapability[] {
  return [
    {
      capability_id: 'ocp.push.batch',
      description: 'Provider pushes batched product objects to the catalog sync API.',
      direction: 'provider_to_catalog',
      transport: 'http_push',
      sync_model: {
        snapshot: true,
        delta: false,
        stream: false,
      },
      mutation_semantics: {
        upsert: true,
        delete: true,
      },
      batching: {
        enabled: true,
        max_items: 100,
        max_bytes: 1048576,
      },
      cursoring: {
        enabled: false,
      },
      streaming: {
        enabled: false,
      },
      auth: {
        schemes: ['x-api-key'],
      },
      endpoint_contract: {
        hosted_by: 'catalog',
        path_hint: '/ocp/objects/sync',
        required_endpoint_fields: [],
      },
      metadata: {},
    },
  ];
}

function buildCommerceQueryCapabilities(options: { semanticSearchEnabled?: boolean }): CatalogManifest['query_capabilities'] {
  const queryPacks: CatalogManifest['query_capabilities'][number]['query_packs'] = [
    {
      pack_id: 'ocp.query.keyword.v1',
      description: 'Keyword-driven product retrieval.',
      query_modes: ['keyword', 'hybrid'],
      metadata: {},
    },
    {
      pack_id: 'ocp.query.filter.v1',
      description: 'Structured filter retrieval for product catalogs.',
      query_modes: ['filter', 'hybrid'],
      metadata: {},
    },
  ];
  if (options.semanticSearchEnabled) {
    queryPacks.push({
      pack_id: 'ocp.query.semantic.v1',
      description: 'Semantic retrieval over embedded product representations.',
      query_modes: ['semantic', 'hybrid'],
      metadata: {
        semantic_search: {
          enabled: true,
          embedding_index: 'catalog_entry_embeddings',
        },
      },
    });
  }

  return [
    {
      capability_id: 'ocp.commerce.product.search.v1',
      name: 'Commerce product search',
      description: 'Searches commerce product entries and returns resolvable product candidates.',
      query_packs: queryPacks,
      input_fields: [
        { name: 'query_pack', type: 'string', required: false },
        { name: 'query_mode', type: 'string', required: false },
        { name: 'query', type: 'string', required: false },
        { name: 'filters.category', type: 'string', required: false },
        { name: 'filters.brand', type: 'string', required: false },
        { name: 'filters.currency', type: 'string', required: false },
        { name: 'filters.availability_status', type: 'string', required: false },
        { name: 'filters.provider_id', type: 'string', required: false },
        { name: 'filters.sku', type: 'string', required: false },
        { name: 'filters.min_amount', type: 'number', required: false },
        { name: 'filters.max_amount', type: 'number', required: false },
        { name: 'filters.in_stock_only', type: 'boolean', required: false },
        { name: 'filters.has_image', type: 'boolean', required: false },
      ],
      searchable_field_refs: [
        'ocp.commerce.product.core.v1#/title',
        'ocp.commerce.product.core.v1#/summary',
        'ocp.commerce.product.core.v1#/brand',
        'ocp.commerce.product.core.v1#/category',
        'ocp.commerce.product.core.v1#/sku',
      ],
      filterable_field_refs: [
        'ocp.commerce.product.core.v1#/category',
        'ocp.commerce.product.core.v1#/brand',
        'ocp.commerce.product.core.v1#/sku',
        'ocp.commerce.price.v1#/currency',
        'ocp.commerce.inventory.v1#/availability_status',
      ],
      sortable_field_refs: [],
      supports_explain: true,
      supports_resolve: true,
      metadata: {
        query_hints: {
          filter_fields: ['category', 'brand', 'currency', 'availability_status', 'provider_id', 'sku', 'min_amount', 'max_amount', 'in_stock_only', 'has_image'],
          supported_query_languages: ['en'],
          content_languages: ['en'],
        },
        semantic_search: {
          enabled: Boolean(options.semanticSearchEnabled),
          embedding_index: 'catalog_entry_embeddings',
        },
      },
    },
  ];
}

function validateDescriptorPack(packId: string, data: unknown) {
  const validator = packValidators[packId];
  if (!validator) return { ok: true as const, data };

  const result = validator.safeParse(data);
  if (result.success) return { ok: true as const, data: result.data };

  return {
    ok: false as const,
    errors: result.error.issues.map((issue) => `${packId}${issue.path.length ? `/${issue.path.join('/')}` : ''}: ${issue.message}`),
  };
}

function buildSearchProjection(object: CommercialObject): SearchProjection {
  const descriptorTitle = readDescriptorField(object, 'ocp.commerce.product.core.v1#/title');
  const summary = stringField(object.summary ?? readDescriptorField(object, 'ocp.commerce.product.core.v1#/summary'));
  const category = stringField(readDescriptorField(object, 'ocp.commerce.product.core.v1#/category'));
  const brand = stringField(readDescriptorField(object, 'ocp.commerce.product.core.v1#/brand'));
  const currency = stringField(readDescriptorField(object, 'ocp.commerce.price.v1#/currency'));
  const amount = numberField(readDescriptorField(object, 'ocp.commerce.price.v1#/amount'));
  const listAmount = numberField(readDescriptorField(object, 'ocp.commerce.price.v1#/list_amount'));
  const priceType = stringField(readDescriptorField(object, 'ocp.commerce.price.v1#/price_type'));
  const availabilityStatus = stringField(readDescriptorField(object, 'ocp.commerce.inventory.v1#/availability_status'));
  const quantity = numberField(readDescriptorField(object, 'ocp.commerce.inventory.v1#/quantity'));
  const sku = stringField(readDescriptorField(object, 'ocp.commerce.product.core.v1#/sku'));
  const productUrl = stringField(readDescriptorField(object, 'ocp.commerce.product.core.v1#/product_url'));
  // 透传 product.core.v1.attributes(原始 free-form 字段),供 buildResolveActions 等下游读取。
  // 典型用途:Provider 注入 requires_affiliate_resolution + provider_resolve_hook_url
  // 让 catalog 在 resolve 时回调 Provider 拿动态 ActionBinding。
  const rawAttributes = readDescriptorField(object, 'ocp.commerce.product.core.v1#/attributes');
  const attributesField =
    rawAttributes && typeof rawAttributes === 'object' && !Array.isArray(rawAttributes)
      ? (rawAttributes as Record<string, unknown>)
      : undefined;
  const imageUrls = readDescriptorField(object, 'ocp.commerce.product.core.v1#/image_urls');
  const primaryImageUrl = Array.isArray(imageUrls) ? stringField(imageUrls[0]) : undefined;
  const hasImage = Boolean(primaryImageUrl);
  const hasProductUrl = Boolean(productUrl || object.source_url);
  const qualityTier = deriveQualityTier({
    summary,
    brand,
    category,
    sku,
    amount,
    listAmount,
    availabilityStatus,
    hasImage,
    hasProductUrl,
  });

  const title = stringField(descriptorTitle) ?? object.title;
  const text = [
    title,
    summary,
    brand,
    category,
    sku,
    summarizeFacetValues(object),
  ].filter(Boolean).join(' ').toLowerCase();

  return {
    title,
    ...(summary ? { summary } : {}),
    ...(category ? { category } : {}),
    ...(brand ? { brand } : {}),
    ...(currency ? { currency } : {}),
    ...(amount !== undefined ? { amount } : {}),
    ...(listAmount !== undefined ? { list_amount: listAmount } : {}),
    ...(priceType ? { price_type: priceType } : {}),
    ...(sku ? { sku } : {}),
    ...(availabilityStatus ? { availability_status: availabilityStatus } : {}),
    ...(quantity !== undefined ? { quantity } : {}),
    ...(productUrl ? { product_url: productUrl } : {}),
    ...(primaryImageUrl ? { primary_image_url: primaryImageUrl } : {}),
    discount_present: amount !== undefined && listAmount !== undefined && listAmount > amount,
    has_image: hasImage,
    has_product_url: hasProductUrl,
    quality_tier: qualityTier,
    ...(object.source_url ? { source_url: object.source_url } : {}),
    provider_id: object.provider_id,
    object_id: object.object_id,
    ...(attributesField ? { attributes: attributesField } : {}),
    text,
  };
}

function buildExplainProjection(object: CommercialObject, projection: SearchProjection) {
  return {
    indexed_fields: Object.keys(projection).filter((key) => key !== 'text'),
    descriptor_packs: object.descriptors.map((descriptor: CommercialObject['descriptors'][number]) => descriptor.pack_id),
  };
}

function buildEmbeddingText(_object: CommercialObject, projection: SearchProjection) {
  return [
    projection.title,
    projection.summary,
    projection.brand,
    projection.category,
    projection.sku,
    typeof projection.list_amount === 'number' ? `list price ${projection.list_amount}` : undefined,
    projection.text,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0).join('\n');
}

// 单次回调 Provider 的超时,2s 内不返就降级到静态 view_product
const PROVIDER_HOOK_TIMEOUT_MS = 2000;

/**
 * Generate ActionBindings for a resolved entry.
 *
 * Two sources:
 *   1. Static `view_product` synthesized from projection.product_url / source_url
 *      (always present if the entry has a URL).
 *   2. Dynamic bindings from a Provider-side resolve hook, requested when the
 *      entry's `attributes.requires_affiliate_resolution` flag is true.
 *      The Provider's hook URL is read from `attributes.provider_resolve_hook_url`.
 *
 * Provider failures (timeout, non-2xx, malformed response) are swallowed:
 *   resolution must keep working even if the Provider is down.
 */
async function buildResolveActions(
  projection: Record<string, unknown>,
  ctx: ResolveContext,
): Promise<ActionBinding[]> {
  const actions: ActionBinding[] = [];

  // ---- (1) Static view_product fallback ----
  const url = typeof projection.product_url === 'string'
    ? projection.product_url
    : typeof projection.source_url === 'string'
      ? projection.source_url
      : null;
  if (url) {
    actions.push({
      action_id: 'view_product',
      action_type: 'url',
      label: 'View product',
      url,
      method: 'GET',
    });
  }

  // ---- (2) Dynamic Provider resolve_hook callback ----
  const attrs = (projection.attributes && typeof projection.attributes === 'object'
    ? (projection.attributes as Record<string, unknown>)
    : {});

  const requires = attrs.requires_affiliate_resolution === true;
  const hookUrl = typeof attrs.provider_resolve_hook_url === 'string'
    ? attrs.provider_resolve_hook_url
    : null;

  if (requires && hookUrl) {
    try {
      const res = await ctx.fetch(hookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          entry_id: ctx.entryId,
          object_id: projection.sku ?? projection.object_id,
          agent_id: ctx.request.agent?.agent_id,
        }),
        signal: AbortSignal.timeout(PROVIDER_HOOK_TIMEOUT_MS),
      });
      if (res.ok) {
        const data = (await res.json()) as { action_bindings?: unknown };
        if (Array.isArray(data.action_bindings)) {
          for (const b of data.action_bindings) {
            // Trust Provider's binding shape; downstream zod will reject if malformed.
            actions.push(b as ActionBinding);
          }
        }
      } else {
        console.warn(
          `[commerce-scenario] resolve_hook returned ${res.status} for entry=${ctx.entryId}`,
        );
      }
    } catch (err) {
      console.warn(
        `[commerce-scenario] resolve_hook failed for entry=${ctx.entryId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return actions;
}

function deriveQualityTier(input: {
  summary?: string;
  brand?: string;
  category?: string;
  sku?: string;
  amount?: number;
  listAmount?: number;
  availabilityStatus?: string;
  hasImage: boolean;
  hasProductUrl: boolean;
}) {
  const hasPrice = input.amount !== undefined && Number.isFinite(input.amount) && input.amount > 0;
  const hasCatalogBasics = hasPrice && Boolean(input.hasProductUrl) && Boolean(input.availabilityStatus) && (Boolean(input.brand) || Boolean(input.category));
  const hasRichFields = input.hasImage && Boolean(input.summary) && Boolean(input.sku);

  if (hasCatalogBasics && hasRichFields) return 'rich';
  if (hasCatalogBasics) return 'standard';
  return 'basic';
}

function summarizeFacetValues(object: CommercialObject) {
  const attributes = readDescriptorField(object, 'ocp.commerce.product.core.v1#/attributes');
  if (!attributes || typeof attributes !== 'object') return undefined;

  return Object.entries(attributes as Record<string, unknown>)
    .filter(([key, value]) => ['color', 'size', 'material', 'model', 'capacity'].includes(key) && typeof value === 'string')
    .map(([key, value]) => `${key} ${value}`)
    .join(' ');
}
