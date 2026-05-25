import type { PageArtifactDefinition } from './types';

export const handshakeArtifacts: Record<string, PageArtifactDefinition> = {
  '/handshake/catalog-manifest': {
      schemaSections: [
        {
          title: { en: 'Required Fields', zh: '必需字段' },
          sourcePath: 'ocp.catalog.handshake.v1/catalog-manifest.schema.json',
          select: (schema) => ({ required: schema.required }),
        },
        {
          title: { en: 'Query Capability Shape', zh: '查询能力结构' },
          sourcePath: 'ocp.catalog.handshake.v1/catalog-manifest.schema.json',
          select: (schema) => ({
            query_capabilities: {
              type: schema.properties?.query_capabilities?.type,
              items: schema.properties?.query_capabilities?.items?.properties,
            },
          }),
        },
        {
          title: { en: 'Provider Sync Capability Shape', zh: 'Provider 同步能力结构' },
          sourcePath: 'ocp.catalog.handshake.v1/catalog-manifest.schema.json',
          select: (schema) => ({
            provider_contract: {
              sync_capabilities: schema.properties?.provider_contract?.properties?.sync_capabilities,
            },
          }),
        },
      ],
      implementationRefs: [
        {
          label: { en: 'Commerce scenario manifest builder', zh: '电商场景 manifest 构建器' },
          path: 'apps/examples/commerce-catalog-api/src/commerce-scenario.ts',
        },
        {
          label: { en: 'Runtime manifest schema', zh: '运行时 manifest schema' },
          path: 'packages/ocp-schema/src/index.ts',
        },
      ],
      endpointExamples: [
        {
          title: { en: 'Fetch well-known catalog discovery', zh: '获取 catalog 的 well-known 发现文档' },
          method: 'GET',
          path: '/.well-known/ocp-catalog',
          response: {
            catalog_id: 'commerce_catalog_local_dev',
            manifest_url: 'http://localhost:4000/ocp/manifest',
            contracts_url: 'http://localhost:4000/ocp/contracts',
            provider_registration_url: 'http://localhost:4000/ocp/providers/register',
            object_sync_url: 'http://localhost:4000/ocp/objects/sync',
            query_url: 'http://localhost:4000/ocp/query',
            resolve_url: 'http://localhost:4000/ocp/resolve',
          },
        },
        {
          title: { en: 'Fetch catalog manifest', zh: '获取 catalog manifest' },
          method: 'GET',
          path: '/ocp/manifest',
          response: {
            kind: 'CatalogManifest',
            catalog_id: 'commerce_catalog_local_dev',
            catalog_name: 'Commerce Product Search Catalog',
          },
        },
      ],
    },
  '/handshake/object-contract': {
      schemaSections: [
        {
          title: { en: 'Contract Core Fields', zh: 'Contract 核心字段' },
          sourcePath: 'ocp.catalog.handshake.v1/object-contract.schema.json',
          select: (schema) => ({
            required: schema.required,
            properties: {
              required_fields: schema.properties?.required_fields,
              optional_fields: schema.properties?.optional_fields,
              additional_fields_policy: schema.properties?.additional_fields_policy,
            },
          }),
        },
      ],
      implementationRefs: [
        {
          label: { en: 'Commerce object contracts', zh: '电商对象 contract 定义' },
          path: 'apps/examples/commerce-catalog-api/src/commerce-scenario.ts',
        },
      ],
      endpointExamples: [
        {
          title: { en: 'List object contracts', zh: '列出 object contracts' },
          method: 'GET',
          path: '/ocp/contracts',
          response: {
            kind: 'ObjectContractList',
            catalog_id: 'commerce_catalog_local_dev',
            contracts: [
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
                  'ocp.commerce.inventory.v1#/availability_status',
                  'ocp.commerce.inventory.v1#/quantity',
                ],
                additional_fields_policy: 'allow',
              },
            ],
          },
        },
      ],
    },
  '/handshake/sync-capabilities': {
      schemaSections: [
        {
          title: { en: 'Catalog Sync Capability Shape', zh: 'Catalog 同步能力结构' },
          sourcePath: 'ocp.catalog.handshake.v1/catalog-manifest.schema.json',
          select: (schema) => ({
            provider_contract: schema.properties?.provider_contract?.properties?.sync_capabilities,
          }),
        },
        {
          title: { en: 'Provider Sync Declaration Shape', zh: 'Provider 同步声明结构' },
          sourcePath: 'ocp.catalog.handshake.v1/provider-registration.schema.json',
          select: (schema) => ({
            sync: schema.properties?.object_declarations?.items?.properties?.sync,
          }),
        },
        {
          title: { en: 'Selected Sync Capability Shape', zh: '协商结果结构' },
          sourcePath: 'ocp.catalog.handshake.v1/registration-result.schema.json',
          select: (schema) => ({
            selected_sync_capability: schema.properties?.selected_sync_capability,
          }),
        },
      ],
      implementationRefs: [
        {
          label: { en: 'Commerce catalog sync capability declaration', zh: '电商 catalog 同步能力声明' },
          path: 'apps/examples/commerce-catalog-api/src/commerce-scenario.ts',
        },
        {
          label: { en: 'Provider sync declaration builder', zh: 'Provider 同步声明构造器' },
          path: 'apps/examples/commerce-provider-api/src/provider-mapper.ts',
        },
        {
          label: { en: 'Registration capability negotiation', zh: '注册阶段能力协商逻辑' },
          path: 'packages/catalog-core/src/registration-service.ts',
        },
      ],
    },
  '/handshake/provider-registration': {
      schemaSections: [
        {
          title: { en: 'Provider Registration Schema', zh: 'Provider 注册 schema' },
          sourcePath: 'ocp.catalog.handshake.v1/provider-registration.schema.json',
          select: (schema) => ({
            required: schema.required,
            properties: {
              provider: schema.properties?.provider,
              object_declarations: schema.properties?.object_declarations,
            },
          }),
        },
      ],
      implementationRefs: [
        {
          label: { en: 'Provider registration payload builder', zh: 'Provider 注册载荷构造器' },
          path: 'apps/examples/commerce-provider-api/src/provider-mapper.ts',
        },
        {
          label: { en: 'Provider registration API and orchestration', zh: 'Provider 注册 API 与编排' },
          path: 'apps/examples/commerce-provider-api/src/provider-service.ts',
        },
      ],
      endpointExamples: [
        {
          title: { en: 'Register provider to catalog', zh: '向 catalog 注册 provider' },
          method: 'POST',
          path: '/ocp/providers/register',
          request: {
            kind: 'ProviderRegistration',
            catalog_id: 'commerce_catalog_local_dev',
            registration_version: 3,
            provider: {
              provider_id: 'commerce_provider_local_dev',
              entity_type: 'merchant',
              display_name: 'Commerce Provider Local Dev',
              homepage: 'http://localhost:4200',
            },
            object_declarations: [
              {
                guaranteed_fields: [
                  'ocp.commerce.product.core.v1#/title',
                  'ocp.commerce.price.v1#/currency',
                  'ocp.commerce.price.v1#/amount',
                  'ocp.commerce.product.core.v1#/product_url',
                ],
                optional_fields: [
                  'ocp.commerce.product.core.v1#/summary',
                  'ocp.commerce.product.core.v1#/brand',
                  'ocp.commerce.product.core.v1#/category',
                  'ocp.commerce.product.core.v1#/sku',
                  'ocp.commerce.product.core.v1#/image_urls',
                  'ocp.commerce.inventory.v1#/availability_status',
                  'ocp.commerce.inventory.v1#/quantity',
                ],
                sync: {
                  preferred_capabilities: ['ocp.push.batch'],
                  avoid_capabilities_unless_necessary: [],
                  provider_endpoints: {},
                },
              },
            ],
          },
          response: {
            kind: 'RegistrationResult',
            status: 'accepted_full',
            effective_registration_version: 3,
            matched_object_contract_count: 1,
            selected_sync_capability: {
              capability_id: 'ocp.push.batch',
              reason: 'provider_preferred_and_supported_by_catalog',
            },
            warnings: [],
          },
        },
      ],
    },
  '/handshake/commercial-object': {
      schemaSections: [
        {
          title: { en: 'Commercial Object Envelope', zh: 'CommercialObject 包络' },
          sourcePath: 'ocp.catalog.handshake.v1/commercial-object.schema.json',
          select: (schema) => ({
            required: schema.required,
            properties: {
              object_id: schema.properties?.object_id,
              object_type: schema.properties?.object_type,
              provider_id: schema.properties?.provider_id,
              descriptors: schema.properties?.descriptors,
            },
          }),
        },
      ],
      implementationRefs: [
        {
          label: { en: 'Provider product to CommercialObject mapping', zh: 'Provider 商品到 CommercialObject 的映射' },
          path: 'apps/examples/commerce-provider-api/src/provider-mapper.ts',
        },
        {
          label: { en: 'Object projection and sync persistence', zh: '对象投影与同步持久化' },
          path: 'packages/catalog-core/src/object-sync-service.ts',
        },
      ],
      endpointExamples: [
        {
          title: { en: 'Sync commercial objects into catalog', zh: '向 catalog 同步 commercial objects' },
          method: 'POST',
          path: '/ocp/objects/sync',
          headers: {
            'x-api-key': '<catalog-object-sync-key>',
          },
          request: {
            provider_id: 'commerce_provider_local_dev',
            registration_version: 3,
            objects: [
              {
                kind: 'CommercialObject',
                object_id: 'electronics-headphones-001',
                object_type: 'product',
                provider_id: 'commerce_provider_local_dev',
                title: 'Noise Cancelling Headphones',
                summary: 'Wireless over-ear headphones with travel case.',
                descriptors: [
                  {
                    pack_id: 'ocp.commerce.product.core.v1',
                    data: {
                      title: 'Noise Cancelling Headphones',
                      summary: 'Wireless over-ear headphones with travel case.',
                      brand: 'North Audio',
                      category: 'electronics',
                      sku: 'electronics-headphones-001',
                      product_url: 'http://localhost:4200/products/electronics-headphones-001',
                      image_urls: ['https://commerce-provider.example.test/images/electronics-headphones-001.jpg'],
                      attributes: {
                        color: 'black',
                      },
                    },
                  },
                  {
                    pack_id: 'ocp.commerce.price.v1',
                    data: {
                      currency: 'USD',
                      amount: 129,
                      list_amount: 159,
                      price_type: 'fixed',
                    },
                  },
                  {
                    pack_id: 'ocp.commerce.inventory.v1',
                    data: {
                      availability_status: 'low_stock',
                      quantity: 4,
                    },
                  },
                ],
              },
            ],
          },
          response: {
            kind: 'ObjectSyncResult',
            accepted_count: 1,
            rejected_count: 0,
            status: 'accepted',
          },
        },
      ],
    },
  '/handshake/registration-result': {
      schemaSections: [
        {
          title: { en: 'Registration Result Status Fields', zh: 'RegistrationResult 状态字段' },
          sourcePath: 'ocp.catalog.handshake.v1/registration-result.schema.json',
          select: (schema) => ({
            required: schema.required,
            properties: {
              status: schema.properties?.status,
              matched_object_contract_count: schema.properties?.matched_object_contract_count,
              effective_registration_version: schema.properties?.effective_registration_version,
              selected_sync_capability: schema.properties?.selected_sync_capability,
              missing_required_fields: schema.properties?.missing_required_fields,
              warnings: schema.properties?.warnings,
            },
          }),
        },
      ],
      implementationRefs: [
        {
          label: { en: 'Provider registration result handling', zh: 'Provider 注册结果处理' },
          path: 'apps/examples/commerce-provider-api/src/provider-service.ts',
        },
      ],
      endpointExamples: [
        {
          title: { en: 'Registration result example', zh: '注册结果示例' },
          method: 'POST',
          path: '/ocp/providers/register',
          response: {
            kind: 'RegistrationResult',
            status: 'accepted_full',
            effective_registration_version: 3,
            matched_object_contract_count: 1,
            selected_sync_capability: {
              capability_id: 'ocp.push.batch',
              reason: 'provider_preferred_and_supported_by_catalog',
            },
            missing_required_fields: [],
            warnings: [],
          },
        },
      ],
    },
};
