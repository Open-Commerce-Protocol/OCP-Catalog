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
