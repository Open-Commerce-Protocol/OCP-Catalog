import { z } from 'zod';

export const ocpVersionSchema = z.literal('1.0');
export const requirementLevelSchema = z.enum(['required', 'optional', 'accepted']);
export const registrationStatusSchema = z.enum([
  'accepted_full',
  'accepted_limited',
  'rejected',
  'pending_verification',
]);

export const endpointSchema = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT']),
});

export const catalogQueryModeSchema = z.enum(['keyword', 'filter', 'semantic', 'hybrid']);
export const syncCapabilityDirectionSchema = z.enum([
  'provider_to_catalog',
  'catalog_pull_provider',
  'provider_stream_to_catalog',
]);

export const fieldRefSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]*#\/[A-Za-z0-9_.~/-]+$/);

export const fieldRuleSchema = z.object({
  field_ref: z.string().min(1),
  requirement: requirementLevelSchema,
  usage: z
    .array(z.enum(['identity', 'index', 'filter', 'rank', 'display', 'resolve', 'reference']))
    .default([]),
  accepted_aliases: z.array(z.string().min(1)).optional(),
  note: z.string().optional(),
});

export const fieldRequirementSchema = z.union([
  fieldRefSchema,
  z.array(fieldRefSchema).min(1),
]);

export const objectContractSchema = z.object({
  required_fields: z.array(fieldRequirementSchema).min(1),
  optional_fields: z.array(fieldRefSchema).default([]),
  additional_fields_policy: z.enum(['allow', 'ignore', 'reject']).default('allow'),
});

export const syncModelSchema = z.object({
  snapshot: z.boolean(),
  delta: z.boolean(),
  stream: z.boolean(),
});

export const mutationSemanticsSchema = z.object({
  upsert: z.boolean(),
  delete: z.boolean(),
});

export const providerEndpointSchema = z.object({
  url: z.string().url(),
}).catchall(z.unknown());

export const syncCapabilitySchema = z.object({
  capability_id: z.string().min(1),
  description: z.string().optional(),
  direction: syncCapabilityDirectionSchema,
  transport: z.string().min(1),
  sync_model: syncModelSchema,
  mutation_semantics: mutationSemanticsSchema,
  batching: z.object({
    enabled: z.boolean(),
    max_items: z.number().int().min(1).optional(),
    max_bytes: z.number().int().min(1).optional(),
  }).optional(),
  cursoring: z.object({
    enabled: z.boolean(),
  }).optional(),
  streaming: z.object({
    enabled: z.boolean(),
  }).optional(),
  auth: z.object({
    schemes: z.array(z.string().min(1)).default([]),
  }).optional(),
  endpoint_contract: z.object({
    hosted_by: z.enum(['catalog', 'provider']),
    path_hint: z.string().optional(),
    required_endpoint_fields: z.array(z.string().min(1)).default([]),
  }).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const selectedSyncCapabilitySchema = z.object({
  capability_id: z.string().min(1),
  reason: z.string().min(1),
});

export const queryCapabilityMetadataSchema = z.record(z.string(), z.unknown()).default({});

export const queryPackDescriptorSchema = z.object({
  pack_id: z.string().min(1),
  description: z.string().optional(),
  query_modes: z.array(catalogQueryModeSchema).default([]),
  request_schema_uri: z.string().url().optional(),
  metadata: queryCapabilityMetadataSchema,
});

export const catalogQueryCapabilitySchema = z.object({
  capability_id: z.string().min(1),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  query_packs: z.array(queryPackDescriptorSchema).default([]),
  searchable_field_refs: z.array(fieldRefSchema).default([]),
  filterable_field_refs: z.array(fieldRefSchema).default([]),
  sortable_field_refs: z.array(fieldRefSchema).default([]),
  input_fields: z.array(z.record(z.string(), z.unknown())).default([]),
  supports_explain: z.boolean().default(true),
  supports_resolve: z.boolean().default(true),
  metadata: queryCapabilityMetadataSchema,
});

export const catalogManifestSchema = z.object({
  ocp_version: ocpVersionSchema,
  kind: z.literal('CatalogManifest'),
  id: z.string().min(1),
  catalog_id: z.string().min(1),
  catalog_name: z.string().min(1),
  description: z.string().optional(),
  registry_visibility: z.enum(['public', 'partner', 'private']).default('public'),
  endpoints: z.object({
    query: endpointSchema,
    resolve: endpointSchema,
    provider_registration: endpointSchema,
    contracts: endpointSchema,
    object_sync: endpointSchema,
  }),
  query_capabilities: z.array(catalogQueryCapabilitySchema).min(1),
  provider_contract: z.object({
    field_rules: z.array(fieldRuleSchema),
    sync_capabilities: z.array(syncCapabilitySchema).default([]),
  }),
  object_contracts: z.array(objectContractSchema),
});

export const providerRegistrationSchema = z.object({
  ocp_version: ocpVersionSchema,
  kind: z.literal('ProviderRegistration'),
  id: z.string().min(1),
  catalog_id: z.string().min(1),
  registration_version: z.number().int().min(1),
  updated_at: z.string().datetime(),
  provider: z.object({
    provider_id: z.string().min(1),
    entity_type: z.enum(['merchant', 'organization', 'individual', 'platform', 'other']),
    display_name: z.string().min(1),
    homepage: z.string().url(),
    contact_email: z.string().email().optional(),
    domains: z.array(z.string().min(1)).optional(),
  }).passthrough(),
  object_declarations: z.array(z.object({
    guaranteed_fields: z.array(z.string().min(1)),
    optional_fields: z.array(z.string().min(1)).optional(),
    sync: z.object({
      preferred_capabilities: z.array(z.string().min(1)).default([]),
      avoid_capabilities_unless_necessary: z.array(z.string().min(1)).default([]),
      provider_endpoints: z.record(z.string(), providerEndpointSchema).default({}),
    }).superRefine((value, ctx) => {
      if (value.preferred_capabilities.length === 0 && value.avoid_capabilities_unless_necessary.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'At least one sync capability must be declared.',
        });
      }
    }),
  })).min(1),
});

export const commercialObjectSchema = z.object({
  ocp_version: ocpVersionSchema,
  kind: z.literal('CommercialObject'),
  id: z.string().min(1),
  object_id: z.string().min(1),
  object_type: z.string().min(1),
  provider_id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().optional(),
  status: z.enum(['active', 'inactive', 'draft']).default('active'),
  source_url: z.string().url().optional(),
  descriptors: z.array(z.object({
    pack_id: z.string().min(1),
    schema_uri: z.string().url().optional(),
    data: z.record(z.string(), z.unknown()),
  })).min(1).max(20),
});

export const registrationResultSchema = z.object({
  ocp_version: ocpVersionSchema,
  kind: z.literal('RegistrationResult'),
  id: z.string().min(1),
  catalog_id: z.string().min(1),
  provider_id: z.string().optional(),
  status: registrationStatusSchema,
  matched_object_contract_count: z.number().int().min(0).default(0),
  effective_registration_version: z.number().int().min(1).optional(),
  selected_sync_capability: selectedSyncCapabilitySchema.optional(),
  missing_required_fields: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  message: z.string().optional(),
});

export const objectSyncRequestSchema = z.object({
  ocp_version: ocpVersionSchema,
  kind: z.literal('ObjectSyncRequest').default('ObjectSyncRequest'),
  id: z.string().min(1).optional(),
  catalog_id: z.string().min(1),
  provider_id: z.string().min(1),
  registration_version: z.number().int().min(1),
  batch_id: z.string().min(1).optional(),
  objects: z.array(z.unknown()).min(1).max(100),
});

export const objectSyncItemResultSchema = z.object({
  object_id: z.string().optional(),
  status: z.enum(['accepted', 'rejected']),
  commercial_object_id: z.string().optional(),
  catalog_entry_id: z.string().optional(),
  errors: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
});

export const objectSyncResultSchema = z.object({
  ocp_version: ocpVersionSchema,
  kind: z.literal('ObjectSyncResult'),
  id: z.string().min(1),
  catalog_id: z.string().min(1),
  provider_id: z.string().min(1),
  registration_version: z.number().int().min(1),
  batch_id: z.string().min(1),
  status: z.enum(['accepted', 'partial', 'rejected']),
  accepted_count: z.number().int().min(0),
  rejected_count: z.number().int().min(0),
  error_count: z.number().int().min(0),
  items: z.array(objectSyncItemResultSchema),
});

export const catalogQueryFiltersSchema = z.object({
  category: z.string().min(1).optional(),
  brand: z.string().min(1).optional(),
  currency: z.string().min(1).optional(),
  availability_status: z.string().min(1).optional(),
  provider_id: z.string().min(1).optional(),
  sku: z.string().min(1).optional(),
  min_amount: z.number().nonnegative().optional(),
  max_amount: z.number().nonnegative().optional(),
  in_stock_only: z.boolean().optional(),
  has_image: z.boolean().optional(),
}).strict();

export const catalogQueryRequestSchema = z.object({
  ocp_version: ocpVersionSchema.optional(),
  kind: z.literal('CatalogQueryRequest').optional(),
  catalog_id: z.string().min(1).optional(),
  query_pack: z.string().min(1).optional(),
  query: z.string().max(500).optional().default(''),
  filters: catalogQueryFiltersSchema.optional().default({}),
  limit: z.number().int().min(1).max(50).optional().default(20),
  explain: z.boolean().optional().default(true),
});

export const queryResultItemSchema = z.object({
  entry_id: z.string(),
  provider_id: z.string(),
  object_id: z.string(),
  title: z.string(),
  summary: z.string().optional(),
  score: z.number(),
  attributes: z.record(z.string(), z.unknown()),
  explain: z.array(z.string()).default([]),
});

export const catalogQueryResultSchema = z.object({
  ocp_version: ocpVersionSchema,
  kind: z.literal('CatalogQueryResult'),
  id: z.string(),
  catalog_id: z.string(),
  query_pack: z.string().optional(),
  query: z.string(),
  result_count: z.number().int().min(0),
  items: z.array(queryResultItemSchema),
  explain: z.array(z.string()).default([]),
});

export const resolveRequestSchema = z.object({
  ocp_version: ocpVersionSchema.optional(),
  kind: z.literal('ResolveRequest').optional(),
  catalog_id: z.string().min(1).optional(),
  entry_id: z.string().min(1),
});

export const actionBindingSchema = z.object({
  action_id: z.string().min(1),
  action_type: z.enum(['url']),
  label: z.string().min(1),
  url: z.string().url(),
  method: z.literal('GET').default('GET'),
});

export const resolvableReferenceSchema = z.object({
  ocp_version: ocpVersionSchema,
  kind: z.literal('ResolvableReference'),
  id: z.string().min(1),
  catalog_id: z.string().min(1),
  entry_id: z.string().min(1),
  commercial_object_id: z.string().min(1),
  object_id: z.string().min(1),
  object_type: z.string().min(1),
  provider_id: z.string().min(1),
  registration_version: z.number().int().min(1).optional(),
  title: z.string().min(1),
  visible_attributes: z.record(z.string(), z.unknown()),
  action_bindings: z.array(actionBindingSchema),
  freshness: z.object({
    object_updated_at: z.string().datetime(),
    resolved_at: z.string().datetime(),
  }),
  expires_at: z.string().datetime(),
});

export const productCorePackSchema = z.object({
  title: z.string().min(1),
  summary: z.string().optional(),
  brand: z.string().optional(),
  category: z.string().optional(),
  sku: z.string().optional(),
  product_url: z.string().url().optional(),
  image_urls: z.array(z.string().url()).optional(),
  video_urls: z.array(z.string().url()).optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const pricePackSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  amount: z.number(),
  list_amount: z.number().optional(),
  price_type: z.enum(['fixed', 'range']).optional(),
}).strict();

export const inventoryPackSchema = z.object({
  availability_status: z.enum(['in_stock', 'low_stock', 'out_of_stock', 'preorder', 'unknown']),
  quantity: z.number().int().min(0).optional(),
}).strict();

export type CatalogManifest = z.infer<typeof catalogManifestSchema>;
export type ObjectContract = z.infer<typeof objectContractSchema>;
export type SyncCapability = z.infer<typeof syncCapabilitySchema>;
export type SelectedSyncCapability = z.infer<typeof selectedSyncCapabilitySchema>;
export type ProviderRegistration = z.infer<typeof providerRegistrationSchema>;
export type CommercialObject = z.infer<typeof commercialObjectSchema>;
export type RegistrationResult = z.infer<typeof registrationResultSchema>;
export type ObjectSyncRequest = z.infer<typeof objectSyncRequestSchema>;
export type ObjectSyncResult = z.infer<typeof objectSyncResultSchema>;
export type ObjectSyncItemResult = z.infer<typeof objectSyncItemResultSchema>;
export type CatalogQueryRequest = z.infer<typeof catalogQueryRequestSchema>;
export type CatalogQueryResult = z.infer<typeof catalogQueryResultSchema>;
export type QueryResultItem = z.infer<typeof queryResultItemSchema>;
export type ResolveRequest = z.infer<typeof resolveRequestSchema>;
export type ResolvableReference = z.infer<typeof resolvableReferenceSchema>;
export type ActionBinding = z.infer<typeof actionBindingSchema>;
