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
      description: 'Use for free-text product search over title, summary, brand, category, SKU, and selected product attributes.',
      query_modes: ['keyword', 'hybrid'],
      metadata: {
        usage: 'Send query text. Optional filters can narrow results when combined with this pack.',
        example_request: {
          query_pack: 'ocp.query.keyword.v1',
          query: 'wireless travel headphones',
          filters: {},
          limit: 10,
          offset: 0,
        },
      },
    },
    {
      pack_id: 'ocp.query.filter.v1',
      description: 'Use for structured browsing, filtered listing, and clean list requests without free-text search.',
      query_modes: ['filter', 'hybrid'],
      metadata: {
        usage: 'Send filters plus limit/offset. A request with only limit and offset lists active products.',
        example_request: {
          query_pack: 'ocp.query.filter.v1',
          filters: {
            category: 'electronics',
            in_stock_only: true,
          },
          limit: 20,
          offset: 0,
        },
      },
    },
  ];
  if (options.semanticSearchEnabled) {
    queryPacks.push({
      pack_id: 'ocp.query.semantic.v1',
      description: 'Use for meaning-based retrieval over embedded product representations when exact keywords are not enough.',
      query_modes: ['semantic', 'hybrid'],
      metadata: {
        usage: 'Send natural-language query text. Results depend on asynchronous search embedding readiness.',
        example_request: {
          query_pack: 'ocp.query.semantic.v1',
          query: 'lightweight audio gear for commuting',
          limit: 10,
          offset: 0,
        },
        semantic_search: {
          enabled: true,
          embedding_index: 'catalog_search_embeddings',
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
        { name: 'query_pack', type: 'string', required: false, description: 'Optional pack id from query_packs. Omit when unsure.' },
        { name: 'query', type: 'string', required: false, description: 'Free-text or semantic search phrase. Omit for clean list/filter browsing.' },
        { name: 'limit', type: 'number', required: false, default: 20, maximum: 50, description: 'Page size.' },
        { name: 'offset', type: 'number', required: false, default: 0, description: 'Zero-based offset for pagination.' },
        { name: 'filters.category', type: 'string', required: false, description: 'Exact normalized category match, for example electronics.' },
        { name: 'filters.brand', type: 'string', required: false, description: 'Exact normalized brand match.' },
        { name: 'filters.currency', type: 'string', required: false, description: 'Currency code such as USD.' },
        { name: 'filters.availability_status', type: 'string', required: false, description: 'Inventory status such as in_stock, low_stock, out_of_stock, preorder, or unknown.' },
        { name: 'filters.provider_id', type: 'string', required: false, description: 'Limit results to one provider.' },
        { name: 'filters.sku', type: 'string', required: false, description: 'Exact normalized SKU match.' },
        { name: 'filters.min_amount', type: 'number', required: false, description: 'Minimum price amount, inclusive.' },
        { name: 'filters.max_amount', type: 'number', required: false, description: 'Maximum price amount, inclusive.' },
        { name: 'filters.in_stock_only', type: 'boolean', required: false, description: 'When true, return only in_stock or low_stock products.' },
        { name: 'filters.has_image', type: 'boolean', required: false, description: 'When true, return products with a primary image.' },
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
        usage_guide: {
          summary: 'Call endpoints.query.url with CatalogQueryRequest. Use query_pack only when it exactly matches one of the declared pack ids.',
          clean_list: 'For a plain product list, omit query, query_pack, and filters; send only catalog_id, limit, and offset.',
          keyword_search: 'For text search, use ocp.query.keyword.v1 when declared and set query to the user search phrase.',
          filter_search: 'For category, brand, price, stock, image, provider, or SKU constraints, use filters. Query text is optional.',
          semantic_search: 'Use ocp.query.semantic.v1 only when declared. Semantic results depend on asynchronous embedding readiness.',
          pagination: 'Use limit and offset. Continue with page.next_offset while page.has_more is true.',
          resolve: 'Use endpoints.resolve.url only after selecting one returned entry_id. The request kind is ResolveRequest.',
          request_field_policy: 'Do not send fields that are not listed in input_fields unless this catalog documents them elsewhere.',
        },
        request_examples: {
          clean_list: {
            catalog_id: '<catalog_id>',
            limit: 20,
            offset: 0,
            explain: false,
          },
          keyword_search: {
            catalog_id: '<catalog_id>',
            query_pack: 'ocp.query.keyword.v1',
            query: 'wireless travel headphones',
            filters: {},
            limit: 10,
            offset: 0,
            explain: true,
          },
          filtered_browse: {
            catalog_id: '<catalog_id>',
            query_pack: 'ocp.query.filter.v1',
            filters: {
              category: 'electronics',
              in_stock_only: true,
              min_amount: 50,
              max_amount: 150,
            },
            limit: 10,
            offset: 0,
            explain: true,
          },
          semantic_search: options.semanticSearchEnabled
            ? {
                catalog_id: '<catalog_id>',
                query_pack: 'ocp.query.semantic.v1',
                query: 'lightweight audio gear for commuting',
                limit: 10,
                offset: 0,
                explain: true,
              }
            : undefined,
          resolve_selected_entry: {
            ocp_version: '1.0',
            kind: 'ResolveRequest',
            catalog_id: '<catalog_id>',
            entry_id: '<entry_id from query result>',
          },
        },
        response_contract: {
          pagination: {
            result_count: 'Number of items in the current page.',
            page: {
              limit: 'Requested page size.',
              offset: 'Requested zero-based offset.',
              has_more: 'Whether another page is available.',
              next_offset: 'Offset to use for the next page when has_more is true.',
            },
          },
          item: {
            entry_id: 'Use this id with /ocp/resolve after selecting a result.',
            score: 'Catalog-specific ranking score.',
            attributes: 'Visible product attributes safe for display.',
            explain: 'Optional ranking and filter explanation when explain is true.',
          },
        },
        query_hints: {
          filter_fields: ['category', 'brand', 'currency', 'availability_status', 'provider_id', 'sku', 'min_amount', 'max_amount', 'in_stock_only', 'has_image'],
          supported_query_languages: ['en'],
          content_languages: ['en'],
        },
        semantic_search: {
          enabled: Boolean(options.semanticSearchEnabled),
          embedding_index: 'catalog_search_embeddings',
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

function buildResolveActions(projection: Record<string, unknown>): ActionBinding[] {
  const url = typeof projection.product_url === 'string'
    ? projection.product_url
    : typeof projection.source_url === 'string'
      ? projection.source_url
      : null;

  if (!url) return [];

  return [
    {
      action_id: 'view_product',
      action_type: 'url',
      label: 'View product',
      url,
      method: 'GET',
    },
  ];
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
