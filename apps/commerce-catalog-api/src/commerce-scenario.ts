import {
  inventoryPackSchema,
  pricePackSchema,
  productCorePackSchema,
  type ActionBinding,
  type CatalogManifest,
  type CommercialObject,
  type ObjectContract,
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
      contract_id: 'contract.product.default.v1',
      object_type: 'product',
      required_packs: ['ocp.commerce.product.core.v1'],
      optional_packs: ['ocp.commerce.price.v1', 'ocp.commerce.inventory.v1'],
      compatible_packs: {},
      field_rules: [
        {
          field_ref: 'ocp.commerce.product.core.v1#/title',
          requirement: 'required',
          usage: ['identity', 'index', 'display', 'resolve'],
        },
        {
          field_ref: 'ocp.commerce.product.core.v1#/summary',
          requirement: 'optional',
          usage: ['index', 'display', 'resolve'],
        },
        {
          field_ref: 'ocp.commerce.product.core.v1#/brand',
          requirement: 'optional',
          usage: ['index', 'filter', 'display', 'resolve'],
        },
        {
          field_ref: 'ocp.commerce.product.core.v1#/category',
          requirement: 'optional',
          usage: ['index', 'filter', 'display', 'resolve'],
        },
        {
          field_ref: 'ocp.commerce.product.core.v1#/product_url',
          requirement: 'optional',
          usage: ['reference', 'resolve'],
        },
        {
          field_ref: 'ocp.commerce.price.v1#/currency',
          requirement: 'optional',
          usage: ['filter', 'display', 'resolve'],
        },
        {
          field_ref: 'ocp.commerce.price.v1#/amount',
          requirement: 'optional',
          usage: ['filter', 'rank', 'display', 'resolve'],
        },
        {
          field_ref: 'ocp.commerce.inventory.v1#/availability_status',
          requirement: 'optional',
          usage: ['filter', 'display', 'resolve'],
        },
      ],
      registration_modes: ['push_api', 'feed_url'],
      additional_fields_policy: 'allow',
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
      target_object_types: ['product'],
      input_fields: [
        { name: 'query_pack', type: 'string', required: false },
        { name: 'query_mode', type: 'string', required: false },
        { name: 'query', type: 'string', required: false },
        { name: 'filters.object_type', type: 'string', required: false },
        { name: 'filters.category', type: 'string', required: false },
        { name: 'filters.brand', type: 'string', required: false },
        { name: 'filters.currency', type: 'string', required: false },
        { name: 'filters.availability_status', type: 'string', required: false },
        { name: 'filters.provider_id', type: 'string', required: false },
      ],
      searchable_field_refs: [
        'ocp.commerce.product.core.v1#/title',
        'ocp.commerce.product.core.v1#/summary',
        'ocp.commerce.product.core.v1#/brand',
        'ocp.commerce.product.core.v1#/category',
      ],
      filterable_field_refs: [
        'ocp.commerce.product.core.v1#/category',
        'ocp.commerce.product.core.v1#/brand',
        'ocp.commerce.price.v1#/currency',
        'ocp.commerce.inventory.v1#/availability_status',
      ],
      sortable_field_refs: [],
      supports_explain: true,
      supports_resolve: true,
      metadata: {
        query_hints: {
          filter_fields: ['object_type', 'category', 'brand', 'currency', 'availability_status', 'provider_id'],
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
  const availabilityStatus = stringField(readDescriptorField(object, 'ocp.commerce.inventory.v1#/availability_status'));
  const productUrl = stringField(readDescriptorField(object, 'ocp.commerce.product.core.v1#/product_url'));

  const title = stringField(descriptorTitle) ?? object.title;
  const text = [
    title,
    summary,
    category,
    brand,
    currency,
    availabilityStatus,
    object.provider_id,
    object.object_type,
  ].filter(Boolean).join(' ').toLowerCase();

  return {
    title,
    ...(summary ? { summary } : {}),
    ...(category ? { category } : {}),
    ...(brand ? { brand } : {}),
    ...(currency ? { currency } : {}),
    ...(amount !== undefined ? { amount } : {}),
    ...(availabilityStatus ? { availability_status: availabilityStatus } : {}),
    ...(productUrl ? { product_url: productUrl } : {}),
    ...(object.source_url ? { source_url: object.source_url } : {}),
    provider_id: object.provider_id,
    object_id: object.object_id,
    object_type: object.object_type,
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
    projection.currency,
    projection.availability_status,
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
