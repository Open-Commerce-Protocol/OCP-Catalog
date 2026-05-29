import type { LocalizedText } from './i18n';

export type UpdateCategory = 'Protocol' | 'Implementation' | 'Examples' | 'Docs';

export type SiteUpdate = {
  slug: string;
  publishedAt: string;
  category: UpdateCategory;
  version?: string;
  breaking: boolean;
  tags: string[];
  title: LocalizedText;
  summary: LocalizedText;
  body: LocalizedText[];
};

export const updates: SiteUpdate[] = [
  {
    slug: 'ocp-catalog-integrates-agent-platforms',
    publishedAt: '2026-05-29',
    category: 'Implementation',
    breaking: false,
    tags: ['coze', 'qclaw', 'agent-platform', 'integration'],
    title: {
      en: 'OCP Catalog is being integrated into agent platforms like Coze and QClaw',
      zh: 'OCP Catalog 正在接入 Coze、QClaw 等智能体平台',
    },
    summary: {
      en: 'The OCP Catalog plugin is being integrated and adapted across agent platforms such as Coze and QClaw, so their agents can discover catalog objects while the final deal still returns to the merchant.',
      zh: 'OCP Catalog 插件正在接入、适配 Coze、QClaw 等智能体平台，让平台上的 Agent 可以发现 Catalog 对象，而最终成交仍回到商家侧。',
    },
    body: [
      {
        en: 'Work is currently in progress to bring the OCP Catalog plugin to agent platforms including Coze and QClaw. The goal is that an agent on those platforms can discover and compare catalog objects through the standard OCP workflow.',
        zh: '我们正在推进将 OCP Catalog 插件接入 Coze、QClaw 等智能体平台。目标是让这些平台上的 Agent 能够通过标准 OCP 工作流，发现并比较 Catalog 对象。',
      },
      {
        en: 'The boundary stays the same as every other OCP integration: catalogs help with discovery, search, and resolve, but checkout and the final commercial relationship return to the merchant. Platform availability will be rolled out gradually.',
        zh: '边界与其他 OCP 集成保持一致：Catalog 负责发现、搜索与 resolve，但结账与最终商业关系仍回到商家。各平台的支持会逐步上线。',
      },
    ],
  },
  {
    slug: 'ocp-cli-and-skill-coming-soon',
    publishedAt: '2026-05-29',
    category: 'Implementation',
    version: 'cli-preview',
    breaking: false,
    tags: ['cli', 'skill', 'tooling', 'manifest-validation'],
    title: {
      en: 'An OCP CLI and agent skill are coming soon — available now from GitHub',
      zh: 'OCP CLI 与 Agent skill 即将推出，现可从 GitHub 尝鲜',
    },
    summary: {
      en: 'A CLI and an agent skill give agents a correct, repeatable way to drive the OCP workflow, including manifest-based request validation. They are not on npm yet, but early adopters can run them from the repository today.',
      zh: 'CLI 与 Agent skill 让 Agent 以正确、可复用的方式驱动 OCP 工作流，并带 manifest 请求校验。它们还没上 npm，但尝鲜用户现在已经可以从仓库运行。',
    },
    body: [
      {
        en: 'The CLI turns the standard OCP workflow into commands — discover, search, inspect, query, resolve — and returns structured JSON for both help and results, so agents can act on output without parsing terminal prose.',
        zh: 'CLI 把标准 OCP 工作流变成命令——发现、搜索、查看、查询、resolve——并且 help 和结果都返回结构化 JSON，因此 Agent 无需解析终端文本即可基于输出行动。',
      },
      {
        en: 'The most useful piece is manifest-based request validation: before a query is sent, the CLI checks it against the Catalog manifest and rejects an unsupported query pack, an unknown filter field, invalid pagination, or a missing query string — keeping agent parameters clean and moving errors earlier.',
        zh: '最有用的能力是基于 manifest 的请求校验：在查询发送前，CLI 会用 Catalog manifest 校验请求，拒绝不支持的 query pack、未知 filter 字段、非法分页或缺失的查询文本——让 Agent 传参更规范，把错误前移。',
      },
      {
        en: 'It is not published to npm yet, so it is marked as coming soon. To try it now, clone github.com/Open-Commerce-Protocol/OCP-Catalog and run the bundled CLI, or install the standalone skill into your agent. See the docs page CLI & Skill (/docs/cli-and-skill) for the full guide.',
        zh: '它还没有发布到 npm，因此标注为即将推出。想现在尝鲜，可以克隆 github.com/Open-Commerce-Protocol/OCP-Catalog 运行内置 CLI，或把独立 skill 安装到你的 Agent。完整引导见文档「CLI 与 Skill」页面（/docs/cli-and-skill）。',
      },
    ],
  },
  {
    slug: 'shopify-provider-app-syncs-merchant-products',
    publishedAt: '2026-05-29',
    category: 'Implementation',
    version: 'provider-app-v1',
    breaking: false,
    tags: ['shopify', 'provider-app', 'merchant-products', 'commerce'],
    title: {
      en: 'Shopify merchant products can now flow into OCP catalogs',
      zh: 'Shopify 商家的商品现在可以同步进 OCP Catalog',
    },
    summary: {
      en: 'The Shopify provider app turns an installed merchant store into an OCP Provider, registers it with a catalog, and syncs products so agents can discover the items while the final deal still returns to the merchant storefront.',
      zh: 'Shopify provider app 会把已安装的商家店铺变成 OCP Provider，注册到合适的 Catalog，并同步商品，让 Agent 可以发现商品，而最终交易仍回到商家店铺页面完成。',
    },
    body: [
      {
        en: 'The app connects to Shopify Admin GraphQL, builds a ProviderRegistration for the merchant, maps Shopify products into OCP CommercialObjects, and pushes them through /ocp/providers/register and /ocp/objects/sync.',
        zh: '这个 app 会连接 Shopify Admin GraphQL，为商家生成 ProviderRegistration，把 Shopify 商品映射成 OCP CommercialObject，并通过 /ocp/providers/register 与 /ocp/objects/sync 推送到 Catalog。',
      },
      {
        en: 'Full sync, delta sync, one-product sync, signed product webhooks, tombstones for deleted products, and an admin status endpoint are implemented in the example app. Mock fixtures are enabled by default so the flow can be validated without real merchant credentials.',
        zh: '示例 app 已实现全量同步、增量同步、单商品同步、带签名校验的商品 webhook、删除商品 tombstone，以及 admin status 端点。默认启用 mock fixtures，因此不需要真实商家凭证也能验证完整流程。',
      },
      {
        en: 'The value is practical distribution: a merchant does not need to build a catalog or rewrite agent-side integrations. Once the app is installed and connected, its products become searchable in a compatible OCP catalog, while checkout and the final commercial relationship remain on the original Shopify storefront.',
        zh: '它的价值是实际分发：商家不需要自己搭建 Catalog，也不需要改造 Agent 侧集成。安装并连接 app 之后，商品就可以出现在兼容的 OCP Catalog 中被搜索和推荐；结账与最终商业关系仍然回到原始 Shopify 店铺。',
      },
    ],
  },
  {
    slug: 'woocommerce-provider-app-opens-wordpress-commerce-to-ocp',
    publishedAt: '2026-05-29',
    category: 'Implementation',
    version: 'provider-app-v1',
    breaking: false,
    tags: ['woocommerce', 'provider-app', 'wordpress', 'commerce'],
    title: {
      en: 'WooCommerce stores can publish products through an OCP Provider app',
      zh: 'WooCommerce 店铺可以通过 OCP Provider App 发布商品',
    },
    summary: {
      en: 'The WooCommerce provider app mirrors the Shopify flow over WooCommerce REST: it registers the merchant, syncs products and variations, handles webhooks, and sends catalog traffic back to the store page for the final deal.',
      zh: 'WooCommerce provider app 通过 WooCommerce REST 复用 Shopify 同类流程：注册商家、同步商品和变体、处理 webhook，并把最终成交流量带回店铺商品页面。',
    },
    body: [
      {
        en: 'The app reads products from /wp-json/wc/v3/products, maps WooCommerce fields into OCP product, price, and inventory packs, and registers the merchant as a Provider with ocp.push.batch sync capability.',
        zh: '这个 app 会从 /wp-json/wc/v3/products 读取商品，把 WooCommerce 字段映射到 OCP 的 product、price、inventory packs，并以带 ocp.push.batch 同步能力的 Provider 形式注册商家。',
      },
      {
        en: 'It supports full sync, modified-after delta sync, single-product sync, variable-product variation embedding, HMAC-signed WooCommerce webhooks, and inactive tombstones for deleted products.',
        zh: '它支持全量同步、基于 modified_after 的增量同步、单商品同步、可变商品变体嵌入、WooCommerce HMAC webhook 校验，以及删除商品的 inactive tombstone。',
      },
      {
        en: 'This makes WordPress commerce inventory available to OCP-compatible catalogs without forcing merchants into a new storefront. Catalogs can promote and resolve the merchant products, but the final product page and transaction remain under the merchant site.',
        zh: '这让 WordPress 电商库存可以进入 OCP 兼容 Catalog，而不要求商家迁移到新的店铺系统。Catalog 可以负责推广、搜索和 resolve 商品，但最终商品页与交易仍保留在商家自己的站点。',
      },
    ],
  },
  {
    slug: 'unified-public-site',
    publishedAt: '2026-05-28',
    category: 'Docs',
    version: 'site-v1',
    breaking: true,
    tags: ['website', 'docs', 'information-architecture'],
    title: {
      en: 'OCP Catalog now has a clearer home for visitors and builders',
      zh: 'OCP Catalog 现在有了更清晰的访客与开发者入口',
    },
    summary: {
      en: 'The site now introduces OCP in plain language, keeps docs available under a dedicated area, and collects project progress in one public place.',
      zh: '站点现在会先用直观语言介绍 OCP，同时保留独立文档区，并把项目进展集中展示在公开页面。',
    },
    body: [
      {
        en: 'Visitors now land on a visual overview first: what OCP connects, how agents use catalogs, and where action boundaries stay under user control. Detailed protocol material remains available under /docs.',
        zh: '访客现在会先看到可视化概览：OCP 连接了什么、Agent 如何使用 Catalog、动作边界如何保持在用户控制之下。更详细的协议资料继续保留在 /docs。',
      },
      {
        en: 'Existing schema references, examples, and implementation notes are still available for builders who want to go deeper.',
        zh: '已有 schema 参考、示例和实现说明仍然保留，方便开发者继续深入。',
      },
    ],
  },
  {
    slug: 'catalog-handshake-and-registration-v1',
    publishedAt: '2026-05-25',
    category: 'Protocol',
    version: 'v1.0-dev',
    breaking: false,
    tags: ['handshake', 'registration', 'schema'],
    title: {
      en: 'Handshake v1 and Registration v1 docs are published as first-class protocol areas',
      zh: 'Handshake v1 与 Registration v1 文档成为一等协议区域',
    },
    summary: {
      en: 'The protocol docs now separate provider handshake contracts from registration discovery contracts, while preserving schema fragments and repo implementation references.',
      zh: '协议文档将 provider handshake contract 与 registration discovery contract 分层呈现，同时保留 schema 片段和仓库实现引用。',
    },
    body: [
      {
        en: 'Handshake pages describe CatalogManifest, ObjectContract, SyncCapabilities, ProviderRegistration, CommercialObject, and RegistrationResult.',
        zh: 'Handshake 页面覆盖 CatalogManifest、ObjectContract、SyncCapabilities、ProviderRegistration、CommercialObject 和 RegistrationResult。',
      },
      {
        en: 'Registration pages cover discovery, catalog registration, catalog search, route hints, verification, and refresh behavior.',
        zh: 'Registration 页面覆盖发现、目录注册、目录搜索、路由提示、验证和刷新行为。',
      },
    ],
  },
  {
    slug: 'commerce-examples-expanded',
    publishedAt: '2026-05-24',
    category: 'Examples',
    version: 'examples-v1',
    breaking: false,
    tags: ['catalog', 'provider', 'agent'],
    title: {
      en: 'Commerce examples expanded across catalog, provider, and agent flows',
      zh: '电商示例扩展到 Catalog、Provider 和 Agent 流程',
    },
    summary: {
      en: 'Minimal catalog/provider examples, Shopify-style provider onboarding, WebMCP demo notes, and reference agent flows now live together under the docs examples area.',
      zh: '最小 Catalog/Provider、Shopify 风格 provider onboarding、WebMCP demo 说明和参考 Agent 流程现在统一放在文档示例区域。',
    },
    body: [
      {
        en: 'These examples are meant to show the practical boundary between data sourcing, catalog search, resolve, and action execution.',
        zh: '这些示例用于说明数据接入、Catalog 搜索、resolve 和动作执行之间的实际边界。',
      },
    ],
  },
];

export const updateCategoryLabels: Record<UpdateCategory, LocalizedText> = {
  Protocol: { en: 'Protocol', zh: '协议' },
  Implementation: { en: 'Implementation', zh: '实现' },
  Examples: { en: 'Examples', zh: '示例' },
  Docs: { en: 'Docs', zh: '文档' },
};

export const breakingChangeLabel: LocalizedText = {
  en: 'Major update',
  zh: '重要更新',
};

export function getUpdateBySlug(slug: string | undefined): SiteUpdate | undefined {
  return updates.find((update) => update.slug === slug);
}
