# Design — 首页商品规模统计 + 新闻图文支持

- **Date:** 2026-06-07
- **App:** `apps/ocp-site-web`
- **Scope:** 两个独立的官网前端功能，共享既有基础设施（manifest 缓存、react-markdown 渲染管线、i18n）。

---

## 背景

官网（`apps/ocp-site-web`）需要两项增强：

1. **商品规模统计** — 在首页展示"有多少商品在 OCP 协议中流转"。Catalog manifest 新增了可选的 `data_profile`（含 `catalog_entry_count`），可以遍历所有 catalog 累加在案数量。但有的 catalog 存储并索引商品（有 `data_profile`），有的只做桥接/实时转发（无 `data_profile`），需要分两个维度表达。

2. **新闻图文** — 新闻（updates）正文当前是纯文本段落数组，无法插图。改为 Markdown 正文，复用文档系统已有的渲染管线，从而支持图文混排。

两个功能彼此独立，可分别实现与验证。

---

## 功能 A：首页商品规模统计

### A.1 决策汇总（已与用户确认）

| 决策点 | 结论 |
|---|---|
| 统计口径 | 两个维度：**在库索引**（可累加总数）+ **可检索/桥接**（用 ∞ 表达） |
| 措辞基调 | **Stored & indexed / 存储索引** 与 **Streamed on demand / 按需流转** |
| 展示位置 | 首页 Hero 区，**原位替换**左下角三个装饰数字（01/02/03 Discover/Resolve/Confirm） |
| 加载策略 | **客户端懒加载聚合**，不阻塞首屏 |
| ∞ 展现 | 纯 `∞`，不带注脚 |

### A.2 两个维度的天然区分

Manifest schema（`packages/ocp-schema/src/index.ts`）中 `data_profile` 是 **optional**，注释明确它是给"data-owning catalogs"用的；"live forwarding catalogs"（桥接型）不带此字段。因此对每个 catalog 的 manifest：

- **有** `data_profile.catalog_entry_count` → 计入 `storedTotal`（存储索引型，可累加）。
- **无** `data_profile` → 计入 `streamedCatalogCount`（桥接/流转型，无法报确切总数）。

### A.3 数据流：新增 `useCatalogScale` hook

现状：`apps/ocp-site-web/src/lib/useDirectory.ts` 的 `useDirectory()` 聚合各注册节点索引的 catalog 搜索 metadata（`CatalogSearchResultItem`，含 `manifest_url`），但**不拉取每个 catalog 的 manifest**。单个 manifest 仅在 `CatalogDrawer` 打开时由 `useCatalogManifest` 拉取。

新增 `apps/ocp-site-web/src/lib/useCatalogScale.ts`：

1. 内部调用 `useDirectory()` 拿到去重后的 `catalogs`（`CatalogWithSources[]`，每个带 `manifest_url`）。
2. 对每个有 `manifest_url` 的 catalog，扇出拉取其 manifest（复用下方抽取的共享 fetch + 缓存）。
3. 聚合：
   ```
   storedTotal          = Σ manifest.data_profile.catalog_entry_count   （仅累加存在的）
   storedCatalogCount   = 有 data_profile 的 catalog 数
   streamedCatalogCount = 无 data_profile 的 catalog 数
   ```
4. 返回 `{ status, storedTotal, storedCatalogCount, streamedCatalogCount }`，`status ∈ 'loading' | 'ready' | 'unavailable'`。

### A.4 复用与重构：共享 manifest 缓存

`apps/ocp-site-web/src/lib/useCatalogManifest.ts` 已有进程内缓存（`cache` / `inflight` / `fetchOnce`）与类型（`CatalogManifest`、`CatalogDataProfile`）。重构以共享：

- 导出 `fetchManifestOnce(url): Promise<FetchEntry>`（即现有 `fetchOnce`，提升为模块导出或抽到一个小模块），让 `useCatalogScale` 与 `useCatalogManifest`（`CatalogDrawer` 用）共用同一份缓存——同一个 catalog 的 manifest 全站只拉一次。
- `useCatalogManifest` 的对外行为不变（仅内部改为调用共享函数）。

### A.5 数字格式化工具

新增 `apps/ocp-site-web/src/lib/formatScale.ts`：`formatCompactCount(n: number): string`，把 `12_480_000 → "12.4M"`、`9_500 → "9.5K"`、`<1000` 原样。中英共用阿拉伯数字缩写，无需 i18n 分支。

### A.6 UI：重整 Hero，原位替换三个装饰数字

文件：`apps/ocp-site-web/src/pages/HomePage.tsx`

- **移除** `heroStats` 常量（`01/02/03 Discover/Resolve/Confirm`）及其渲染块（约 248–255 行的三列网格）。这块与下方 `flow` section 的 5 步流程语义重复，属于冗余。
- **替换为**两个数据卡片（沿用现有 `rounded-md border bg-white/60 backdrop-blur` 卡片样式，保持 Hero 视觉语言）：

  ```
  ┌─────────────────────────┬─────────────────────────┐
  │ Stored & indexed        │ Streamed on demand      │
  │ 12.4M                   │ ∞                       │
  │ 存储索引                 │ 按需流转                 │
  └─────────────────────────┴─────────────────────────┘
  ```
  - 卡片 1：label `Stored & indexed` / `存储索引`，大数字 `formatCompactCount(storedTotal)`。
  - 卡片 2：label `Streamed on demand` / `按需流转`，大字符 `∞`。
- 数据来自 `useCatalogScale()`。
- **加载/失败态**：
  - `loading` → 数字位显示占位（`—`，或轻量数字淡入）。不阻塞首屏。
  - `unavailable`（所有节点不可达 / 拿不到任何 manifest）→ **整个两卡片区不渲染**（不显示 `0`，避免误导）。
  - 部分 manifest 失败 → 跳过失败项，用已成功的部分聚合（"已知节点"口径）。

### A.7 文案（最终）

| | EN | ZH |
|---|---|---|
| 维度一 label | Stored & indexed | 存储索引 |
| 维度一 值 | `formatCompactCount(storedTotal)` | 同左 |
| 维度二 label | Streamed on demand | 按需流转 |
| 维度二 值 | ∞ | ∞ |

### A.8 测试

- `formatCompactCount` 单元测试：边界（999 / 1000 / 1.0M / 12.4M / 0）。
- `useCatalogScale` 聚合逻辑测试：mock 一组 manifest（部分有 `data_profile`、部分无、部分 fetch 失败），断言 `storedTotal` / `streamedCatalogCount` / `status`。

---

## 功能 B：新闻支持图文（Markdown 正文）

### B.1 决策汇总（已与用户确认）

| 决策点 | 结论 |
|---|---|
| 图文程度 | **Markdown 正文**（图片/加粗/链接/列表/表格） |
| 现有 7 条新闻 | **全部迁到 `.md`**，统一管线，不保留旧的段落数组渲染分支 |

### B.2 复用文档系统的成熟管线

项目已用 `react-markdown@^10.1.0` 渲染文档页（`apps/ocp-site-web/src/pages/PageView.tsx`），内容走 `.md` 文件 + `import.meta.glob(..., {query:'?raw'})` + frontmatter 剥离 + `locales/zh/` 中文回退（`apps/ocp-site-web/src/content/loader.ts`）。新闻完全复用此模式。

### B.3 数据结构改造

文件：`apps/ocp-site-web/src/content/updates.ts`

- `SiteUpdate` 类型**移除** `body: LocalizedText[]` 字段。保留元数据：`slug` / `publishedAt` / `category` / `version?` / `breaking` / `tags` / `title` / `summary`。
- **新增可选封面图**字段：`cover?: string`（相对路径，如 `images/site/xxx.png`）。用于列表页卡片与详情页顶部的图文感增强。
- 正文移出常量，按 slug 约定存为 markdown 文件：
  ```
  src/content/updates/<slug>.md            ← 英文正文
  src/content/updates/locales/zh/<slug>.md ← 中文正文（缺失则回退英文）
  ```

### B.4 正文加载器

新增 `apps/ocp-site-web/src/content/updates-loader.ts`，仿 `loader.ts`：

- `import.meta.glob('./updates/**/*.md', { query: '?raw', import: 'default' })`。
- `loadUpdateContent(slug, locale): Promise<string>` — 优先 `locales/<locale>/<slug>.md`，回退英文；复用同样的 frontmatter 剥离逻辑。
- 找不到时返回一段提示性 markdown（与 `loader.ts` 的缺页提示一致）。

> 注：`loader.ts` 中的 `stripFrontmatter` 可抽到一个共享小工具供两个 loader 复用，避免重复正则。

### B.5 共享 Markdown 渲染器

`PageView.tsx` 的 `createHeadingComponents` 目前与文档导航（`navigate` / `docsContentIdToPublicPath` / TOC heading id）耦合。抽取一个**新闻可用的渲染组件子集**：

- 新建 `apps/ocp-site-web/src/components/site/MarkdownArticle.tsx`（或在 `lib` 下放一个共享的 `markdown-components` 工厂），包含：段落、标题、列表、表格（复用 `parsePipeTable` 逻辑）、代码块、链接（外链直接渲染、内链走 `navigate`）、**图片**（沿用 `src?.startsWith('images/') ? '/'+src : src` 的约定 → 指向 `/images/...`）。
- 图片约定与文档完全一致：`![alt](images/site/xxx.png)`。
- 为避免大改 `PageView.tsx`，第一步先把可复用的纯函数（`parsePipeTable` / `renderTableCellContent` / `extractTextFromNode` / `img` 处理）抽到共享模块，`PageView` 与新闻渲染器都引用。TOC/heading-id 相关逻辑保留在 `PageView` 侧（新闻详情页不需要 TOC）。

### B.6 详情页改造

文件：`apps/ocp-site-web/src/pages/UpdateDetailPage.tsx`

- 移除 `update.body.map(...)` 的纯文本渲染。
- 改为 `useEffect` 异步 `loadUpdateContent(slug, locale)`（模式同 `PageView`：`setContent('# Loading...')` → 加载 → `setContent`，带 `isCancelled` 防竞态）。
- 用共享 `MarkdownArticle` 渲染正文，外层套现有 `docs-prose prose` 样式确保排版一致。
- 若有 `cover`，在标题（`<h1>`）正下方、summary 之上展示封面图（圆角 + 细边框，与文档 `img` 渲染样式一致）。

### B.7 列表页改造

文件：`apps/ocp-site-web/src/pages/UpdatesPage.tsx`

- 列表卡片在有 `cover` 时展示缩略图（不破坏现有 `md:grid-cols-[10rem_1fr_auto]` 布局，可在标题列内嵌小图，或为有图条目调整网格）。无 `cover` 时维持现状。
- 首页"最新新闻"区块（`HomePage.tsx` 末尾 `latestUpdate`）不依赖 body，无需改动；可选地用 `cover` 做背景增强（非本次必需，YAGNI）。

### B.8 迁移现有 7 条新闻

把 `updates.ts` 中现有 7 条的 `body` 段落逐条转成 `.md` 文件：

- 英文段落 → `src/content/updates/<slug>.md`
- 中文段落 → `src/content/updates/locales/zh/<slug>.md`
- 保证文字内容逐段不丢；段落间空行分隔。
- 7 个 slug：`ocp-catalog-integrates-agent-platforms`、`ocp-cli-and-skill-coming-soon`、`shopify-provider-app-syncs-merchant-products`、`woocommerce-provider-app-opens-wordpress-commerce-to-ocp`、`unified-public-site`、`catalog-handshake-and-registration-v1`、`commerce-examples-expanded`。

### B.9 图片资源

新闻配图放 `apps/ocp-site-web/public/images/site/`（与现有 hero 图、`updates-release-ledger.png` 同目录）。Markdown 内用 `images/site/xxx.png` 相对引用，渲染器补前导 `/`。

### B.10 测试

- `loadUpdateContent`：英文命中、中文命中、中文缺失回退英文、slug 不存在返回提示。
- 渲染器抽取后，确认 `PageView` 既有文档渲染行为不回归（手动 + 现有页面验证）。

---

## 影响面与非目标

### 改动文件
- **A:** `lib/useCatalogScale.ts`(新)、`lib/useCatalogManifest.ts`(导出 fetch)、`lib/formatScale.ts`(新)、`pages/HomePage.tsx`、对应测试。
- **B:** `content/updates.ts`、`content/updates-loader.ts`(新)、`components/site/MarkdownArticle.tsx`(新)、`pages/UpdateDetailPage.tsx`、`pages/UpdatesPage.tsx`、`content/updates/**/*.md`(新, 14 个文件)、`pages/PageView.tsx`(抽取共享纯函数)、对应测试。

### 非目标（YAGNI）
- 不做服务端预聚合 / 静态快照（已选客户端懒加载）。
- ∞ 不带注脚。
- 不引入新的 markdown 依赖（复用 `react-markdown`）。
- 不改 manifest schema、不改后端聚合接口。
- 不做新闻 body 的双轨兼容（全量迁移）。

---

## 待用户复核
请检查本 spec，确认无误后进入实现计划（writing-plans）。
