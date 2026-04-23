import type { MaybeLocalizedText } from './i18n';
import { formatJsonFragment, loadSchemaDocument } from './schema-loader';

type SchemaSectionDefinition = {
  title: MaybeLocalizedText;
  sourcePath: string;
  select: (schema: any) => unknown;
  description?: MaybeLocalizedText;
};

type ImplementationRef = {
  label: MaybeLocalizedText;
  path: string;
  note?: MaybeLocalizedText;
};

type PageArtifactDefinition = {
  schemaSections?: SchemaSectionDefinition[];
  implementationRefs?: ImplementationRef[];
  endpointExamples?: EndpointExample[];
};

export type LoadedSchemaSection = {
  title: MaybeLocalizedText;
  description?: MaybeLocalizedText;
  sourcePath: string;
  code: string;
  packageAnchorId: string;
};

export type LoadedSchemaPackage = {
  anchorId: string;
  sourcePath: string;
  code: string;
};

export type EndpointExample = {
  title: MaybeLocalizedText;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  headers?: Record<string, string>;
  request?: unknown;
  response?: unknown;
  note?: MaybeLocalizedText;
};

export type LoadedPageArtifacts = {
  schemaSections: LoadedSchemaSection[];
  schemaPackages: LoadedSchemaPackage[];
  implementationRefs: ImplementationRef[];
  endpointExamples: EndpointExample[];
};

function createSchemaAnchorId(sourcePath: string): string {
  return `schema-package-${sourcePath.replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()}`;
}

const artifactRegistry: Record<string, PageArtifactDefinition> = {
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
          catalog_name: 'Commerce Catalog Local Dev',
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
  '/registration/discovery': {
    schemaSections: [
      {
        title: { en: 'Registration node Discovery Schema', zh: 'CenterDiscovery schema' },
        sourcePath: 'ocp.catalog.center.v1/center-discovery.schema.json',
        select: (schema) => ({
          required: schema.required,
          properties: schema.properties,
        }),
      },
    ],
    implementationRefs: [
      {
        label: { en: 'Registration node API discovery endpoint', zh: 'Registration node API discovery 入口' },
        path: 'apps/ocp-center-api/src/index.ts',
      },
    ],
    endpointExamples: [
      {
        title: { en: 'Fetch Registration node discovery document', zh: '获取 Registration node discovery 文档' },
        method: 'GET',
        path: '/.well-known/ocp-center',
        response: {
          kind: 'CenterDiscovery',
          center_id: 'ocp_center_local_dev',
          manifest_url: 'http://localhost:4100/ocp/registration/manifest',
          catalog_registration_url: 'http://localhost:4100/ocp/catalogs/register',
          catalog_search_url: 'http://localhost:4100/ocp/catalogs/search',
        },
      },
    ],
  },
  '/registration/catalog-registration': {
    schemaSections: [
      {
        title: { en: 'Catalog Registration Schema', zh: 'Catalog 注册 schema' },
        sourcePath: 'ocp.catalog.center.v1/catalog-registration.schema.json',
        select: (schema) => ({
          required: schema.required,
          properties: {
            catalog_id: schema.properties?.catalog_id,
            registration_version: schema.properties?.registration_version,
            well_known_url: schema.properties?.well_known_url,
            claimed_domains: schema.properties?.claimed_domains,
            intended_visibility: schema.properties?.intended_visibility,
            tags: schema.properties?.tags,
          },
        }),
      },
    ],
    implementationRefs: [
      {
        label: { en: 'Catalog registration orchestration', zh: 'Catalog 注册编排' },
        path: 'packages/center-core/src/catalog-registry-service.ts',
      },
      {
        label: { en: 'Catalog registration API', zh: 'Catalog 注册 API' },
        path: 'apps/ocp-center-api/src/index.ts',
      },
    ],
    endpointExamples: [
      {
        title: { en: 'Register catalog to Registration node', zh: '将 catalog 注册到 Registration node' },
        method: 'POST',
        path: '/ocp/catalogs/register',
        request: {
          kind: 'CatalogRegistration',
          center_id: 'ocp_center_local_dev',
          catalog_id: 'commerce_catalog_local_dev',
          registration_version: 3,
          homepage: 'http://localhost:4000',
          well_known_url: 'http://localhost:4000/.well-known/ocp-catalog',
          claimed_domains: ['localhost'],
          intended_visibility: 'public',
          tags: ['commerce', 'products'],
        },
        response: {
          status: 'accepted',
          catalog_id: 'commerce_catalog_local_dev',
          effective_registration_version: 3,
        },
      },
    ],
  },
  '/registration/catalog-search': {
    schemaSections: [
      {
        title: { en: 'Catalog Search Request', zh: 'Catalog 搜索请求' },
        sourcePath: 'ocp.catalog.center.v1/catalog-search.schema.json',
        select: (schema) => ({
          required: schema.required,
          properties: schema.properties,
        }),
      },
      {
        title: { en: 'Catalog Search Result Item', zh: 'Catalog 搜索结果项' },
        sourcePath: 'ocp.catalog.center.v1/catalog-search-result.schema.json',
        select: (schema) => ({
          item: schema.properties?.items?.items,
        }),
      },
    ],
    implementationRefs: [
      {
        label: { en: 'Registration node search query service', zh: 'Registration node 搜索服务' },
        path: 'packages/center-core/src/catalog-search-service.ts',
      },
      {
        label: { en: 'User demo agent Registration node search client', zh: '用户 demo agent 的 Registration node 搜索客户端' },
        path: 'apps/examples/ocp-user-demo-api/src/agent-service.ts',
      },
    ],
    endpointExamples: [
      {
        title: { en: 'Search Registration node for a catalog', zh: '在 Registration node 中搜索 catalog' },
        method: 'POST',
        path: '/ocp/catalogs/search',
        request: {
          query: 'travel headphones under 150 with image',
          filters: {
            query_pack: 'ocp.commerce.product.search.v1',
          },
          limit: 5,
          explain: true,
        },
        response: {
          result_count: 1,
          items: [
            {
              catalog_id: 'commerce_catalog_local_dev',
              catalog_name: 'Commerce Catalog Local Dev',
              route_hint: {
                query_url: 'http://localhost:4000/ocp/query',
              },
            },
          ],
        },
      },
    ],
  },
  '/registration/catalog-route-hint': {
    schemaSections: [
      {
        title: { en: 'Catalog Route Hint Schema', zh: 'CatalogRouteHint schema' },
        sourcePath: 'ocp.catalog.center.v1/catalog-route-hint.schema.json',
        select: (schema) => ({
          required: schema.required,
          properties: schema.properties,
        }),
      },
    ],
    implementationRefs: [
      {
        label: { en: 'Route hint projection', zh: 'Route hint 投影逻辑' },
        path: 'packages/center-core/src/projection.ts',
      },
      {
        label: { en: 'User demo route-hint consumption', zh: '用户 demo 对 route hint 的消费逻辑' },
        path: 'apps/examples/ocp-user-demo-api/src/agent-service.ts',
      },
    ],
    endpointExamples: [
      {
        title: { en: 'Route hint fragment returned by Registration node search', zh: 'Registration node search 返回的 route hint 片段' },
        method: 'POST',
        path: '/ocp/catalogs/search',
        response: {
          route_hint: {
            catalog_id: 'commerce_catalog_local_dev',
            manifest_url: 'http://localhost:4000/ocp/manifest',
            query_url: 'http://localhost:4000/ocp/query',
            resolve_url: 'http://localhost:4000/ocp/resolve',
            supported_query_packs: ['ocp.commerce.product.search.v1'],
            metadata: {
              query_hints: {
                supported_query_modes: ['keyword', 'filter', 'semantic', 'hybrid'],
                supported_query_languages: ['en'],
                content_languages: ['en'],
              },
            },
          },
        },
      },
    ],
  },
  '/registration/verification-refresh': {
    schemaSections: [
      {
        title: { en: 'Verification Request', zh: '验证请求' },
        sourcePath: 'ocp.catalog.center.v1/catalog-verification.schema.json',
        select: (schema) => schema,
      },
      {
        title: { en: 'Refresh Result', zh: '刷新结果' },
        sourcePath: 'ocp.catalog.center.v1/catalog-refresh-result.schema.json',
        select: (schema) => ({
          required: schema.required,
          properties: schema.properties,
        }),
      },
      {
        title: { en: 'Token Rotation Result', zh: '令牌轮换结果' },
        sourcePath: 'ocp.catalog.center.v1/catalog-token-rotation-result.schema.json',
        select: (schema) => ({
          required: schema.required,
          properties: schema.properties,
        }),
      },
    ],
    implementationRefs: [
      {
        label: { en: 'Registration node verification and refresh APIs', zh: 'Registration node 验证与刷新 API' },
        path: 'apps/ocp-center-api/src/index.ts',
      },
    ],
    endpointExamples: [
      {
        title: { en: 'Verify catalog control', zh: '验证 catalog 控制权' },
        method: 'POST',
        path: '/ocp/catalogs/:catalogId/verify',
        request: {
          challenge_id: 'challenge_local_dev_001',
        },
        response: {
          status: 'verified',
          catalog_id: 'commerce_catalog_local_dev',
        },
      },
      {
        title: { en: 'Refresh catalog snapshot', zh: '刷新 catalog snapshot' },
        method: 'POST',
        path: '/ocp/catalogs/:catalogId/refresh',
        headers: {
          'x-catalog-token': '<catalog-token>',
        },
        response: {
          status: 'refreshed',
          indexed: true,
          health_status: 'healthy',
        },
      },
      {
        title: { en: 'Rotate catalog access token', zh: '轮换 catalog 访问令牌' },
        method: 'POST',
        path: '/ocp/catalogs/:catalogId/token/rotate',
        headers: {
          'x-catalog-token': '<catalog-token>',
        },
        response: {
          catalog_access_token: '<new-token>',
          token_issued_at: '2026-04-21T00:00:00.000Z',
        },
      },
    ],
  },
  '/examples/commerce-catalog': {
    implementationRefs: [
      {
        label: { en: 'Commerce scenario definition', zh: '电商场景定义' },
        path: 'apps/examples/commerce-catalog-api/src/commerce-scenario.ts',
      },
      {
        label: { en: 'Catalog query service', zh: 'Catalog 查询服务' },
        path: 'packages/catalog-core/src/query-service.ts',
      },
      {
        label: { en: 'Embedding ANN shortlist and rerank', zh: 'Embedding ANN 候选召回与重排' },
        path: 'packages/catalog-core/src/embedding-service.ts',
      },
    ],
    endpointExamples: [
      {
        title: { en: 'Query commerce catalog', zh: '查询电商 catalog' },
        method: 'POST',
        path: '/ocp/query',
        request: {
          kind: 'CatalogQueryRequest',
          query: 'travel headphones',
          query_pack: 'ocp.commerce.product.search.v1',
          filters: {
            category: 'electronics',
            in_stock_only: true,
            has_image: true,
            min_amount: 100,
            max_amount: 150,
          },
          explain: true,
        },
        response: {
          kind: 'CatalogQueryResult',
          result_count: 3,
          items: [
            {
              entry_id: 'centry_01_example',
              provider_id: 'commerce_provider_local_dev',
              object_id: 'electronics-headphones-001',
              title: 'Noise Cancelling Headphones',
              score: 0.97,
              attributes: {
                category: 'electronics',
                brand: 'North Audio',
                sku: 'electronics-headphones-001',
                amount: 129,
                list_amount: 159,
                availability_status: 'low_stock',
                primary_image_url: 'https://commerce-provider.example.test/images/electronics-headphones-001.jpg',
                quality_tier: 'rich',
                has_image: true,
                discount_present: true,
              },
              explain: [
                'Inferred query strategy: hybrid.',
                'Matched category filter: electronics.',
                'Applied semantic ANN shortlist with exact cosine rerank.',
              ],
            },
          ],
          explain: [
            'Returned commerce product entries ranked with keyword, filter, and quality signals.',
          ],
        },
      },
      {
        title: { en: 'Resolve catalog result', zh: 'Resolve catalog 结果' },
        method: 'POST',
        path: '/ocp/resolve',
        request: {
          kind: 'ResolveRequest',
          entry_id: 'centry_01_example',
        },
        response: {
          kind: 'ResolvableReference',
          entry_id: 'centry_01_example',
          object_id: 'electronics-headphones-001',
          title: 'Noise Cancelling Headphones',
          visible_attributes: {
            category: 'electronics',
            brand: 'North Audio',
            amount: 129,
            list_amount: 159,
            availability_status: 'low_stock',
            primary_image_url: 'https://commerce-provider.example.test/images/electronics-headphones-001.jpg',
            quality_tier: 'rich',
            discount_present: true,
          },
          action_bindings: [
            {
              action_id: 'view_product',
              action_type: 'url',
              label: 'View product',
              url: 'http://localhost:4200/products/electronics-headphones-001',
              method: 'GET',
            },
          ],
        },
      },
    ],
  },
  '/examples/minimal-catalog': {
    implementationRefs: [
      {
        label: { en: 'Catalog manifest schema', zh: 'Catalog manifest schema' },
        path: 'ocp.catalog.handshake.v1/catalog-manifest.schema.json',
      },
      {
        label: { en: 'Catalog registration schema', zh: 'Catalog 注册 schema' },
        path: 'ocp.catalog.center.v1/catalog-registration.schema.json',
      },
    ],
    endpointExamples: [
      {
        title: { en: 'Serve minimal discovery', zh: '提供最小 discovery' },
        method: 'GET',
        path: '/.well-known/ocp-catalog',
        response: {
          kind: 'WellKnownCatalogDiscovery',
          catalog_id: 'hello_catalog',
          manifest_url: 'https://catalog.example.com/ocp/manifest',
          query_url: 'https://catalog.example.com/ocp/query',
        },
      },
      {
        title: { en: 'Serve minimal query', zh: '提供最小 query' },
        method: 'POST',
        path: '/ocp/query',
        request: {
          example_filed: true,
        },
        response: {
          kind: 'CatalogQueryResult',
          catalog_id: 'hello_catalog',
          result_count: 1,
          items: [
            {
              entry_id: 'hello_entry',
              title: 'hello world! true example filed',
            },
          ],
        },
      },
      {
        title: { en: 'Register minimal catalog to Registration node', zh: '把最小 catalog 注册到 Registration node' },
        method: 'POST',
        path: '/ocp/catalogs/register',
        request: {
          kind: 'CatalogRegistration',
          center_id: 'my_center',
          catalog_id: 'hello_catalog',
          registration_version: 1,
          homepage: 'https://catalog.example.com',
          well_known_url: 'https://catalog.example.com/.well-known/ocp-catalog',
          claimed_domains: ['catalog.example.com'],
          intended_visibility: 'public',
          tags: ['example'],
        },
        response: {
          kind: 'CatalogRegistrationResult',
          status: 'accepted_indexed',
          effective_registration_version: 1,
        },
      },
    ],
  },
  '/examples/minimal-provider': {
    implementationRefs: [
      {
        label: { en: 'Provider registration schema', zh: 'Provider 注册 schema' },
        path: 'ocp.catalog.handshake.v1/provider-registration.schema.json',
      },
      {
        label: { en: 'Commercial object schema', zh: 'CommercialObject schema' },
        path: 'ocp.catalog.handshake.v1/commercial-object.schema.json',
      },
    ],
    endpointExamples: [
      {
        title: { en: 'Register minimal provider', zh: '注册最小 provider' },
        method: 'POST',
        path: '/ocp/providers/register',
        request: {
          kind: 'ProviderRegistration',
          catalog_id: 'hello_catalog',
          registration_version: 1,
          provider: {
            provider_id: 'hello_provider',
            entity_type: 'merchant',
            display_name: 'Hello Provider',
          },
          object_declarations: [
            {
              guaranteed_fields: ['hello.example.object.v1#/message'],
              optional_fields: [],
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
          effective_registration_version: 1,
        },
      },
      {
        title: { en: 'Sync one provider object', zh: '同步一个 provider 对象' },
        method: 'POST',
        path: '/ocp/objects/sync',
        headers: {
          'x-api-key': '<catalog-object-sync-key>',
        },
        request: {
          kind: 'ObjectSyncRequest',
          catalog_id: 'hello_catalog',
          provider_id: 'hello_provider',
          registration_version: 1,
          batch_id: 'batch_hello_001',
          objects: [
            {
              kind: 'CommercialObject',
              object_id: 'hello_object',
              object_type: 'example',
              provider_id: 'hello_provider',
              title: 'hello world object',
            },
          ],
        },
        response: {
          kind: 'ObjectSyncResult',
          status: 'accepted',
          accepted_count: 1,
          rejected_count: 0,
        },
      },
    ],
  },
  '/examples/registration-flow': {
    implementationRefs: [
      {
        label: { en: 'Registration node API', zh: 'Registration node API' },
        path: 'apps/ocp-center-api/src/index.ts',
      },
      {
        label: { en: 'Catalog registry service', zh: 'Catalog 注册服务' },
        path: 'packages/center-core/src/catalog-registry-service.ts',
      },
      {
        label: { en: 'Registration node state persistence schema', zh: 'Registration node 状态持久化 schema' },
        path: 'packages/db/src/schema/center.ts',
      },
    ],
    endpointExamples: [
      {
        title: { en: 'Register catalog into Registration node', zh: '向 Registration node 注册 catalog' },
        method: 'POST',
        path: '/ocp/catalogs/register',
        request: {
          kind: 'CatalogRegistration',
          center_id: 'ocp_center_local_dev',
          catalog_id: 'commerce_catalog_local_dev',
          registration_version: 1,
          homepage: 'http://localhost:4000',
          well_known_url: 'http://localhost:4000/.well-known/ocp-catalog',
          claimed_domains: ['localhost'],
          intended_visibility: 'public',
          tags: ['commerce', 'demo'],
        },
        response: {
          kind: 'CatalogRegistrationResult',
          status: 'accepted_indexed',
          effective_registration_version: 1,
          manifest_fetch_status: 'fetched',
          verification_status: 'not_required',
          health_status: 'healthy',
          indexed: true,
          catalog_access_token: '<catalog-token>',
        },
      },
      {
        title: { en: 'Refresh active snapshot', zh: '刷新 active snapshot' },
        method: 'POST',
        path: '/ocp/catalogs/:catalogId/refresh',
        headers: {
          'x-catalog-token': '<catalog-token>',
        },
        request: {},
        response: {
          kind: 'CatalogRefreshResult',
          status: 'refreshed',
          catalog_id: 'commerce_catalog_local_dev',
          snapshot_id: 'catsnap_example_01',
          health_status: 'healthy',
          indexed: true,
          warnings: [],
        },
      },
      {
        title: { en: 'Search the Registration node index', zh: '搜索 Registration node 索引' },
        method: 'POST',
        path: '/ocp/catalogs/search',
        request: {
          query: 'commerce products',
          filters: {
            verification_status: 'not_required',
            health_status: 'healthy',
          },
          limit: 5,
        },
        response: {
          kind: 'CatalogSearchResult',
          result_count: 1,
          items: [
            {
              catalog_id: 'commerce_catalog_local_dev',
              catalog_name: 'Commerce Catalog Local Dev',
              verification_status: 'not_required',
              trust_tier: 'declared',
              health_status: 'healthy',
              route_hint: {
                manifest_url: 'http://localhost:4000/ocp/manifest',
                query_url: 'http://localhost:4000/ocp/query',
                resolve_url: 'http://localhost:4000/ocp/resolve',
              },
            },
          ],
        },
      },
    ],
  },
  '/examples/provider-flow': {
    implementationRefs: [
      {
        label: { en: 'Provider API', zh: 'Provider API' },
        path: 'apps/examples/commerce-provider-api/src/index.ts',
      },
      {
        label: { en: 'Provider publishing orchestration', zh: 'Provider 发布编排逻辑' },
        path: 'apps/examples/commerce-provider-api/src/provider-service.ts',
      },
      {
        label: { en: 'Provider admin web', zh: 'Provider 管理后台前端' },
        path: 'apps/examples/commerce-provider-admin-web/src/App.tsx',
      },
    ],
    endpointExamples: [
      {
        title: { en: 'Publish provider to catalog in one step', zh: '一步完成 provider 发布到 catalog' },
        method: 'POST',
        path: '/api/provider-admin/provider/publish-to-catalog',
        headers: {
          'x-admin-key': '<provider-admin-key>',
        },
        request: {
          registration_version: 3,
        },
        response: {
          provider_id: 'commerce_provider_local_dev',
          registration_version: 3,
          status: 'succeeded',
          register_run: {
            runType: 'register',
            status: 'succeeded',
            registrationVersion: 3,
            resultPayload: {
              status: 'accepted_full',
              selected_sync_capability: {
                capability_id: 'ocp.push.batch',
                reason: 'provider_preferred_and_supported_by_catalog',
              },
            },
          },
          sync_run: {
            runType: 'sync_all',
            status: 'succeeded',
            registrationVersion: 3,
            resultPayload: {
              accepted_count: 5,
              rejected_count: 0,
              status: 'accepted',
            },
          },
        },
      },
      {
        title: { en: 'Inspect provider status and quality feedback', zh: '查看 provider 状态与质量反馈' },
        method: 'GET',
        path: '/api/provider-admin/provider/status',
        headers: {
          'x-admin-key': '<provider-admin-key>',
        },
        response: {
          provider_id: 'commerce_provider_local_dev',
          catalog_id: 'commerce_catalog_local_dev',
          status: 'active',
          active_registration_version: 3,
          next_registration_version: 4,
          local_quality: {
            product_count: 5,
            ready_for_publish_count: 5,
            missing_price_count: 0,
            missing_list_price_count: 1,
            missing_product_url_count: 0,
            missing_image_count: 0,
            missing_brand_or_category_count: 0,
            out_of_stock_count: 0,
            active_count: 5,
          },
          publish_readiness: {
            ready: true,
            blocking_issues: [],
            warnings: ['1 product(s) have no useful list price.'],
          },
          catalog_quality: {
            object_count: 5,
            active_entry_count: 5,
            rich_entry_count: 4,
            standard_entry_count: 1,
            basic_entry_count: 0,
            missing_image_count: 0,
            missing_product_url_count: 0,
            out_of_stock_count: 0,
          },
        },
      },
    ],
  },
  '/examples/user-agent-flow': {
    implementationRefs: [
      {
        label: { en: 'User demo agent backend', zh: '用户 demo agent 后端' },
        path: 'apps/examples/ocp-user-demo-api/src/agent-service.ts',
      },
      {
        label: { en: 'User demo web', zh: '用户 demo 前端' },
        path: 'apps/examples/ocp-user-demo-web/src/App.tsx',
      },
    ],
    endpointExamples: [
      {
        title: { en: 'Agent-centered OCP turn', zh: '以 agent 为中心的一次 OCP 交互' },
        method: 'POST',
        path: '/api/user-demo/agent/turn',
        request: {
          message: 'I want travel headphones under 150 with images',
          localCatalogProfiles: [],
        },
        response: {
          reply: 'I found a commerce catalog that can search products with price and availability filters. Do you want to register it locally?',
          state: {
            pendingCatalogRegistration: {
              catalog_id: 'commerce_catalog_local_dev',
            },
          },
        },
        note: {
          en: 'The user demo agent digests tool output before replying, rather than exposing raw Registration node or Catalog payloads directly.',
          zh: '用户 demo 中的 agent 会先消化工具调用结果，再向用户转述，而不是直接暴露原始 Registration node 或 Catalog payload。',
        },
      },
    ],
  },
  '/getting-started': {
    implementationRefs: [
      {
        label: { en: 'Catalog registration orchestration', zh: 'Catalog 注册编排' },
        path: 'packages/center-core/src/catalog-registry-service.ts',
      },
      {
        label: { en: 'Provider registration builder', zh: 'Provider 注册构造器' },
        path: 'apps/examples/commerce-provider-api/src/provider-mapper.ts',
      },
      {
        label: { en: 'Provider publish orchestration', zh: 'Provider 发布编排' },
        path: 'apps/examples/commerce-provider-api/src/provider-service.ts',
      },
    ],
    endpointExamples: [
      {
        title: { en: 'Minimal catalog registration', zh: '最小 catalog 注册示例' },
        method: 'POST',
        path: '/ocp/catalogs/register',
        request: {
          kind: 'CatalogRegistration',
          center_id: 'my_center',
          catalog_id: 'my_catalog',
          registration_version: 1,
          homepage: 'https://catalog.example.com',
          well_known_url: 'https://catalog.example.com/.well-known/ocp-catalog',
          claimed_domains: ['catalog.example.com'],
          intended_visibility: 'public',
          tags: ['example'],
        },
        response: {
          kind: 'CatalogRegistrationResult',
          status: 'accepted_indexed',
          effective_registration_version: 1,
        },
      },
      {
        title: { en: 'Minimal provider registration', zh: '最小 provider 注册示例' },
        method: 'POST',
        path: '/ocp/providers/register',
        request: {
          kind: 'ProviderRegistration',
          catalog_id: 'my_catalog',
          registration_version: 1,
          provider: {
            provider_id: 'my_provider',
            entity_type: 'merchant',
            display_name: 'My Provider',
          },
          object_declarations: [
            {
              guaranteed_fields: [
                'ocp.commerce.product.core.v1#/title',
                'ocp.commerce.price.v1#/currency',
                'ocp.commerce.price.v1#/amount',
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
          effective_registration_version: 1,
        },
      },
      {
        title: { en: 'Minimal object sync', zh: '最小对象同步示例' },
        method: 'POST',
        path: '/ocp/objects/sync',
        headers: {
          'x-api-key': '<catalog-object-sync-key>',
        },
        request: {
          kind: 'ObjectSyncRequest',
          catalog_id: 'my_catalog',
          provider_id: 'my_provider',
          registration_version: 1,
          batch_id: 'batch_001',
          objects: [
            {
              kind: 'CommercialObject',
              object_id: 'sku_001',
              object_type: 'product',
              provider_id: 'my_provider',
              title: 'Example product',
            },
          ],
        },
        response: {
          kind: 'ObjectSyncResult',
          status: 'accepted',
          accepted_count: 1,
          rejected_count: 0,
        },
      },
    ],
  },
  '/faq': {
    implementationRefs: [
      {
        label: { en: 'Registration node verification and refresh logic', zh: 'Registration node 验证与刷新逻辑' },
        path: 'packages/center-core/src/catalog-registry-service.ts',
      },
      {
        label: { en: 'Provider registration state handling', zh: 'Provider 注册状态处理' },
        path: 'packages/catalog-core/src/registration-service.ts',
      },
      {
        label: { en: 'Object sync runtime checks', zh: '对象同步运行时检查' },
        path: 'packages/catalog-core/src/object-sync-service.ts',
      },
    ],
  },
  '/protocol-principles': {
    implementationRefs: [
      {
        label: { en: 'Protocol docs content source', zh: '协议文档内容源' },
        path: 'apps/ocp-protocol-docs-web/src/content/docs/protocol-principles.md',
      },
    ],
  },
  '/query-contract-principles': {
    implementationRefs: [
      {
        label: { en: 'Catalog query capability shape', zh: 'Catalog 查询能力结构' },
        path: 'apps/examples/commerce-catalog-api/src/commerce-scenario.ts',
      },
      {
        label: { en: 'Runtime query mode inference', zh: '运行时 query mode 推断' },
        path: 'packages/catalog-core/src/query-mode.ts',
      },
    ],
  },
  '/routing-principles': {
    implementationRefs: [
      {
        label: { en: 'Registration node projection and route hint shape', zh: 'Registration node 投影与 route hint 结构' },
        path: 'packages/center-core/src/projection.ts',
      },
      {
        label: { en: 'User agent route selection', zh: '用户 agent 的路由选择逻辑' },
        path: 'apps/examples/ocp-user-demo-api/src/agent-service.ts',
      },
    ],
  },
};

export async function loadPageArtifacts(routePath: string): Promise<LoadedPageArtifacts> {
  const normalizedRoutePath = routePath
    .replace(/^\/center\//, '/registration/')
    .replace(/^\/examples\/center-flow$/, '/examples/registration-flow');
  const definition = artifactRegistry[normalizedRoutePath];

  if (!definition) {
    return {
      schemaSections: [],
      schemaPackages: [],
      implementationRefs: [],
      endpointExamples: [],
    };
  }

  const loadedSchemaSections: LoadedSchemaSection[] = [];
  const schemaPackages = new Map<string, LoadedSchemaPackage>();

  if (definition.schemaSections) {
    const sections = await Promise.all(
      definition.schemaSections.map(async (section) => {
        const schema = await loadSchemaDocument(section.sourcePath);

        if (!schema) {
          return null;
        }

        const loadedSection: LoadedSchemaSection = {
          title: section.title,
          sourcePath: section.sourcePath,
          code: formatJsonFragment(section.select(schema)),
          packageAnchorId: createSchemaAnchorId(section.sourcePath),
        };

        if (section.description) {
          loadedSection.description = section.description;
        }

        const packageAnchorId = createSchemaAnchorId(section.sourcePath);
        if (!schemaPackages.has(section.sourcePath)) {
          schemaPackages.set(section.sourcePath, {
            anchorId: packageAnchorId,
            sourcePath: section.sourcePath,
            code: formatJsonFragment(schema),
          });
        }

        return loadedSection;
      }),
    );

    for (const section of sections) {
      if (section) {
        loadedSchemaSections.push(section);
      }
    }
  }

  return {
    schemaSections: loadedSchemaSections,
    schemaPackages: [...schemaPackages.values()],
    implementationRefs: definition.implementationRefs ?? [],
    endpointExamples: definition.endpointExamples ?? [],
  };
}
