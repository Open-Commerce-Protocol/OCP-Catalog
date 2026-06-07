import {
  inventoryPackSchema,
  pricePackSchema,
  productCorePackSchema,
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
    buildResolveAccess,
    buildResolveLiveChecks,
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
      field_usage_policy: [
        {
          field_ref: 'ocp.commerce.product.core.v1#/title',
          requirement: 'required',
          usage: ['index', 'rank', 'display', 'search_visible', 'explain'],
        },
        {
          field_ref: 'ocp.commerce.product.core.v1#/summary',
          requirement: 'optional',
          usage: ['index', 'display', 'search_visible', 'explain'],
        },
        {
          field_ref: 'ocp.commerce.product.core.v1#/image_urls',
          requirement: 'optional',
          usage: ['display', 'search_visible', 'resolve_visible'],
          note: 'CatalogEntry may project the first image as image_url for result previews.',
        },
      ],
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
        stream: true,
      },
      mutation_semantics: {
        upsert: true,
        delete: true,
      },
      batching: {
        enabled: true,
        max_items: 1000,
        max_bytes: 1048576,
      },
      cursoring: {
        enabled: false,
      },
      streaming: {
        enabled: true,
      },
      auth: {
        schemes: ['x-api-key'],
      },
      endpoint_contract: {
        hosted_by: 'catalog',
        path_hint: '/ocp/objects/sync',
        required_endpoint_fields: [],
      },
      metadata: {
        upload_guide: {
          summary: 'External providers register first, then push product objects with x-api-key using either JSON batch sync or NDJSON stream sync.',
          steps: [
            'POST ProviderRegistration to /ocp/providers/register and keep the returned registration_version and provider_api_key.',
            'For ordinary batches, POST ObjectSyncRequest JSON to /ocp/objects/sync with catalog_id, provider_id, registration_version, optional batch_id, and objects.',
            'For large catalog loads, POST application/x-ndjson to /ocp/objects/sync/stream with provider_id, registration_version, batch_id, and optional chunk_size query parameters.',
            'Poll /ocp/object-sync-runs/{sync_run_id}?provider_id={provider_id} after stream uploads to inspect committed chunks and retry checkpoints.',
            'Call /ocp/object-sync-runs/{sync_run_id}/complete?provider_id={provider_id} when a stream run is complete.',
          ],
          auth: {
            header: 'x-api-key',
            source: 'Use the provider_api_key issued by provider registration. It is returned only once and is scoped to the registered provider_id.',
            registration_result_field: 'provider_api_key',
          },
          batch_endpoint: {
            method: 'POST',
            path: '/ocp/objects/sync',
            content_type: 'application/json',
            max_items: 1000,
            max_bytes: 1048576,
            idempotency: 'Use a stable batch_id per provider export chunk. Retrying the same batch_id with identical object payload is safe.',
          },
          stream_endpoint: {
            method: 'POST',
            path: '/ocp/objects/sync/stream',
            content_type: 'application/x-ndjson',
            recommended_for: 'Large initial loads or catalogs with more than 1000 objects.',
            query_fields: ['provider_id', 'registration_version', 'batch_id', 'chunk_size'],
            idempotency: 'The stream batch_id is the sync_run_id. Committed chunks are checkpointed by request_hash and can be retried safely with identical payloads.',
          },
          object_requirements: {
            kind: 'CommercialObject',
            required_descriptor_packs: ['ocp.commerce.product.core.v1', 'ocp.commerce.price.v1'],
            minimum_required_fields: [
              'object_id',
              'object_type',
              'provider_id',
              'title',
              'descriptors[ocp.commerce.product.core.v1].title',
              'descriptors[ocp.commerce.price.v1].currency',
              'descriptors[ocp.commerce.price.v1].amount',
            ],
            recommended_fields_for_search_quality: [
              'summary',
              'brand',
              'category',
              'sku',
              'product_url',
              'image_urls',
              'availability_status',
              'quantity',
            ],
          },
          indexing_behavior: {
            mode: 'async',
            note: 'Object sync accepts valid objects before semantic embeddings are ready. Keyword/filter results become available after search document indexing; semantic/hybrid quality improves after background embedding and OpenSearch upsert jobs complete.',
            provider_expectation: 'Do not wait for embedding completion before sending the next batch. Monitor sync result counts and, when needed, query admin/search-index status endpoints or retry failed sync chunks.',
          },
          provider_rate_guidance: {
            recommended_initial_batch_size: 500,
            max_batch_size: 1000,
            recommended_parallel_streams_per_provider: 1,
            backoff: 'Use exponential backoff with jitter for 429, 503, network timeout, or partial sync failures.',
          },
          examples: {
            object_sync_request: {
              ocp_version: '1.0',
              kind: 'ObjectSyncRequest',
              catalog_id: '<catalog_id>',
              provider_id: '<provider_id>',
              registration_version: 1,
              batch_id: '<stable_batch_id>',
              objects: [
                {
                  ocp_version: '1.0',
                  kind: 'CommercialObject',
                  id: '<provider_id>:<object_id>',
                  object_id: '<object_id>',
                  object_type: 'product',
                  provider_id: '<provider_id>',
                  title: 'Example Product',
                  status: 'active',
                  descriptors: [
                    {
                      pack_id: 'ocp.commerce.product.core.v1',
                      data: {
                        title: 'Example Product',
                        summary: 'Short product description',
                        brand: 'Example Brand',
                        category: 'electronics',
                        sku: 'SKU-123',
                        product_url: 'https://merchant.example/products/sku-123',
                        image_urls: ['https://merchant.example/images/sku-123.jpg'],
                      },
                    },
                    {
                      pack_id: 'ocp.commerce.price.v1',
                      data: {
                        currency: 'USD',
                        amount: 99.99,
                      },
                    },
                    {
                      pack_id: 'ocp.commerce.inventory.v1',
                      data: {
                        availability_status: 'in_stock',
                        quantity: 42,
                      },
                    },
                  ],
                },
              ],
            },
          },
        },
        stream_endpoint_path: '/ocp/objects/sync/stream',
        run_status_endpoint_path: '/ocp/object-sync-runs/{sync_run_id}?provider_id={provider_id}',
        run_complete_endpoint_path: '/ocp/object-sync-runs/{sync_run_id}/complete?provider_id={provider_id}',
        stream_content_type: 'application/x-ndjson',
        stream_query_fields: ['provider_id', 'registration_version', 'batch_id', 'chunk_size'],
        stream_retry_model: 'The stream batch_id is the sync_run_id. Each committed stream chunk is stored as batch_id:<zero-padded chunk index>. Retrying the same stream with identical chunk payloads replays committed chunks by request_hash and suppresses duplicate index jobs by dedupe_key. Providers can query the run status endpoint for committed checkpoint state before retrying.',
      },
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
    ...(primaryImageUrl ? { image_url: primaryImageUrl } : {}),
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

const buildResolveActions: NonNullable<CatalogScenarioModule['buildResolveActions']> = (context) => {
  const url = typeof context.projection.product_url === 'string'
    ? context.projection.product_url
    : typeof context.projection.source_url === 'string'
      ? context.projection.source_url
      : null;

  if (!url) return [];

  return [
    {
      action_id: 'view_product',
      action_type: 'url',
      label: 'View product',
      description: 'Open the provider-owned product detail page for the resolved catalog entry.',
      entrypoint: {
        url,
        method: 'GET',
      },
      auth_requirements: {},
      requires_user_confirmation: false,
      expires_at: context.expires_at,
    },
  ];
};

const buildResolveAccess: NonNullable<CatalogScenarioModule['buildResolveAccess']> = () => ({
  visibility: 'public',
  permission_state: 'granted',
  redacted_fields: ['product_url', 'source_url', 'text'],
  policy_notes: ['Provider-owned action URLs are exposed through action_bindings, not visible_attributes.'],
});

const buildResolveLiveChecks: NonNullable<CatalogScenarioModule['buildResolveLiveChecks']> = (context) => {
  const availabilityStatus = stringField(context.projection.availability_status);
  const checkedAt = context.resolved_at;

  if (!availabilityStatus) {
    return [{
      check_id: 'availability',
      status: 'unknown',
      checked_at: checkedAt,
      summary: 'Availability status is not present in the catalog projection.',
      details: {},
    }];
  }

  return [{
    check_id: 'availability',
    status: availabilityStatus === 'out_of_stock' ? 'failed' : 'passed',
    checked_at: checkedAt,
    summary: availabilityStatus,
    details: {
      availability_status: availabilityStatus,
      ...(typeof context.projection.quantity === 'number' ? { quantity: context.projection.quantity } : {}),
    },
  }];
};

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
