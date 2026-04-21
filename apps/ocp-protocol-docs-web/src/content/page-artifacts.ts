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
    ],
    implementationRefs: [
      {
        label: { en: 'Commerce scenario manifest builder', zh: '电商场景 manifest 构建器' },
        path: 'apps/commerce-catalog-api/src/commerce-scenario.ts',
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
            required_packs: schema.properties?.required_packs,
            optional_packs: schema.properties?.optional_packs,
            field_rules: schema.properties?.field_rules,
            registration_modes: schema.properties?.registration_modes,
          },
        }),
      },
    ],
    implementationRefs: [
      {
        label: { en: 'Commerce object contracts', zh: '电商对象 contract 定义' },
        path: 'apps/commerce-catalog-api/src/commerce-scenario.ts',
      },
    ],
    endpointExamples: [
      {
        title: { en: 'List object contracts', zh: '列出 object contracts' },
        method: 'GET',
        path: '/ocp/contracts?object_type=commerce.product',
        response: {
          kind: 'ObjectContractList',
          catalog_id: 'commerce_catalog_local_dev',
          contracts: [
            {
              contract_id: 'commerce_product_contract_v1',
              object_type: 'commerce.product',
            },
          ],
        },
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
        path: 'apps/commerce-provider-api/src/provider-mapper.ts',
      },
      {
        label: { en: 'Provider registration API and orchestration', zh: 'Provider 注册 API 与编排' },
        path: 'apps/commerce-provider-api/src/provider-service.ts',
      },
    ],
    endpointExamples: [
      {
        title: { en: 'Register provider to catalog', zh: '向 catalog 注册 provider' },
        method: 'POST',
        path: '/ocp/providers/register',
        headers: {
          'x-api-key': '<catalog-write-key>',
        },
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
              object_type: 'commerce.product',
              provided_packs: [
                'ocp.commerce.product.core.v1',
                'ocp.commerce.price.v1',
                'ocp.commerce.inventory.v1',
              ],
              delivery: { mode: 'push_api' },
            },
          ],
        },
        response: {
          kind: 'RegistrationResult',
          status: 'accepted_full',
          effective_registration_version: 3,
          matched_contract_ids: ['commerce_product_contract_v1'],
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
        path: 'apps/commerce-provider-api/src/provider-mapper.ts',
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
          'x-api-key': '<catalog-write-key>',
        },
        request: {
          provider_id: 'commerce_provider_local_dev',
          registration_version: 3,
          objects: [
            {
              kind: 'CommercialObject',
              object_id: 'electronics-headphones-001',
              object_type: 'commerce.product',
              provider_id: 'commerce_provider_local_dev',
              title: 'Wireless Noise Cancelling Headphones',
              descriptors: [
                {
                  pack_id: 'ocp.commerce.product.core.v1',
                  data: { title: 'Wireless Noise Cancelling Headphones' },
                },
              ],
            },
          ],
        },
        response: {
          accepted_count: 1,
          rejected_count: 0,
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
            matched_contract_ids: schema.properties?.matched_contract_ids,
            effective_registration_version: schema.properties?.effective_registration_version,
            missing_required_fields: schema.properties?.missing_required_fields,
            warnings: schema.properties?.warnings,
          },
        }),
      },
    ],
    implementationRefs: [
      {
        label: { en: 'Provider registration result handling', zh: 'Provider 注册结果处理' },
        path: 'apps/commerce-provider-api/src/provider-service.ts',
      },
    ],
    endpointExamples: [
      {
        title: { en: 'Registration result example', zh: '注册结果示例' },
        method: 'POST',
        path: '/ocp/providers/register',
        response: {
          kind: 'RegistrationResult',
          status: 'accepted_limited',
          effective_registration_version: 3,
          matched_contract_ids: ['commerce_product_contract_v1'],
          missing_required_fields: [],
          warnings: ['Semantic search hints unavailable for this provider declaration.'],
        },
      },
    ],
  },
  '/center/center-discovery': {
    schemaSections: [
      {
        title: { en: 'Center Discovery Schema', zh: 'CenterDiscovery schema' },
        sourcePath: 'ocp.catalog.center.v1/center-discovery.schema.json',
        select: (schema) => ({
          required: schema.required,
          properties: schema.properties,
        }),
      },
    ],
    implementationRefs: [
      {
        label: { en: 'Center API discovery endpoint', zh: 'Center API discovery 入口' },
        path: 'apps/ocp-center-api/src/index.ts',
      },
    ],
    endpointExamples: [
      {
        title: { en: 'Fetch center discovery document', zh: '获取 Center discovery 文档' },
        method: 'GET',
        path: '/.well-known/ocp-center',
        response: {
          kind: 'CenterDiscovery',
          center_id: 'ocp_center_local_dev',
          manifest_url: 'http://localhost:4100/ocp/center/manifest',
          catalog_registration_url: 'http://localhost:4100/ocp/catalogs/register',
          catalog_search_url: 'http://localhost:4100/ocp/catalogs/search',
        },
      },
    ],
  },
  '/center/catalog-registration': {
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
            operator: schema.properties?.operator,
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
        title: { en: 'Register catalog to center', zh: '将 catalog 注册到 Center' },
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
          operator: {
            display_name: 'Commerce Catalog Local Dev',
          },
        },
        response: {
          status: 'accepted',
          catalog_id: 'commerce_catalog_local_dev',
          effective_registration_version: 3,
        },
      },
    ],
  },
  '/center/catalog-search': {
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
        label: { en: 'Center search query service', zh: 'Center 搜索服务' },
        path: 'packages/center-core/src/catalog-search-service.ts',
      },
      {
        label: { en: 'User demo agent center search client', zh: '用户 demo agent 的 Center 搜索客户端' },
        path: 'apps/ocp-user-demo-api/src/agent-service.ts',
      },
    ],
    endpointExamples: [
      {
        title: { en: 'Search center for a catalog', zh: '在 Center 中搜索 catalog' },
        method: 'POST',
        path: '/ocp/catalogs/search',
        request: {
          query: 'wireless noise cancelling headphones',
          filters: {
            object_type: 'commerce.product',
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
              matched_object_types: ['commerce.product'],
              route_hint: {
                query_url: 'http://localhost:4000/ocp/query',
              },
            },
          ],
        },
      },
    ],
  },
  '/center/catalog-route-hint': {
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
        path: 'apps/ocp-user-demo-api/src/agent-service.ts',
      },
    ],
    endpointExamples: [
      {
        title: { en: 'Route hint fragment returned by center search', zh: 'Center search 返回的 route hint 片段' },
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
  '/center/verification-refresh': {
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
        label: { en: 'Center verification and refresh APIs', zh: 'Center 验证与刷新 API' },
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
        path: 'apps/commerce-catalog-api/src/commerce-scenario.ts',
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
          query_text: 'wireless noise cancelling headphones',
          object_type: 'commerce.product',
          query_pack: 'ocp.commerce.product.search.v1',
          query_mode: 'hybrid',
          filters: {
            availability_status: 'in_stock',
          },
        },
        response: {
          result_count: 3,
          items: [
            {
              object_id: 'electronics-headphones-001',
              title: 'Wireless Noise Cancelling Headphones',
              score: 0.97,
            },
          ],
        },
      },
      {
        title: { en: 'Resolve catalog result', zh: 'Resolve catalog 结果' },
        method: 'POST',
        path: '/ocp/resolve',
        request: {
          object_id: 'electronics-headphones-001',
          action_id: 'view_product',
        },
        response: {
          action_id: 'view_product',
          url: 'http://localhost:4200/products/electronics-headphones-001',
        },
      },
    ],
  },
  '/examples/provider-flow': {
    implementationRefs: [
      {
        label: { en: 'Provider API', zh: 'Provider API' },
        path: 'apps/commerce-provider-api/src/index.ts',
      },
      {
        label: { en: 'Provider publishing orchestration', zh: 'Provider 发布编排逻辑' },
        path: 'apps/commerce-provider-api/src/provider-service.ts',
      },
      {
        label: { en: 'Provider admin web', zh: 'Provider 管理后台前端' },
        path: 'apps/commerce-provider-admin-web/src/App.tsx',
      },
    ],
    endpointExamples: [
      {
        title: { en: 'Publish provider to catalog in one step', zh: '一步完成 provider 发布到 catalog' },
        method: 'POST',
        path: '/provider/publish-to-catalog',
        headers: {
          'x-admin-key': '<provider-admin-key>',
        },
        request: {
          registration_version: 3,
        },
        response: {
          registration: {
            status: 'accepted_full',
          },
          sync: {
            accepted_count: 5,
            rejected_count: 0,
          },
        },
      },
    ],
  },
  '/examples/user-agent-flow': {
    implementationRefs: [
      {
        label: { en: 'User demo agent backend', zh: '用户 demo agent 后端' },
        path: 'apps/ocp-user-demo-api/src/agent-service.ts',
      },
      {
        label: { en: 'User demo web', zh: '用户 demo 前端' },
        path: 'apps/ocp-user-demo-web/src/App.tsx',
      },
    ],
    endpointExamples: [
      {
        title: { en: 'Agent-centered OCP turn', zh: '以 agent 为中心的一次 OCP 交互' },
        method: 'POST',
        path: '/agent/turn',
        request: {
          message: 'I want wireless noise cancelling headphones',
          localCatalogProfiles: [],
        },
        response: {
          reply: 'I found a commerce catalog that can search products. Do you want to register it locally?',
          state: {
            pendingCatalogRegistration: {
              catalog_id: 'commerce_catalog_local_dev',
            },
          },
        },
        note: {
          en: 'The user demo agent digests tool output before replying, rather than exposing raw Center or Catalog payloads directly.',
          zh: '用户 demo 中的 agent 会先消化工具调用结果，再向用户转述，而不是直接暴露原始 Center 或 Catalog payload。',
        },
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
        path: 'apps/commerce-catalog-api/src/commerce-scenario.ts',
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
        label: { en: 'Center projection and route hint shape', zh: 'Center 投影与 route hint 结构' },
        path: 'packages/center-core/src/projection.ts',
      },
      {
        label: { en: 'User agent route selection', zh: '用户 agent 的路由选择逻辑' },
        path: 'apps/ocp-user-demo-api/src/agent-service.ts',
      },
    ],
  },
};

export async function loadPageArtifacts(routePath: string): Promise<LoadedPageArtifacts> {
  const definition = artifactRegistry[routePath];

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
