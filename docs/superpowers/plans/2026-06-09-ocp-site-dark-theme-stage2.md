# OCP Site 暗色主题 · 阶段二 实现计划

> **For agentic workers:** 由 Commander 逐 Task 调度 Implementation subagent，Task 间审查。

**Goal:** 把 Products / Products-OCP-Catalog / Roadmap 三个营销页改造成与首页一致的暗色沉浸风。

**Architecture:** 复用阶段一令牌系统。三类工作：(A) index.css 命名类暗色覆盖批；(B) Products+Roadmap JSX 令牌化并挂 PageTheme；(C) Directory 卡片/抽屉/过滤器 JSX 令牌化并挂 PageTheme；(D) DirectoryTopology + 反相陷阱专项。卡片背景已因 `--ocp-porcelain` 自动反相，覆盖只补 border/shadow/文字色。

**Tech Stack:** React 19, react-router-dom 7, Tailwind 3.4, Vite 8, Bun。

> **执行约束：** 禁止兜底/吞错/伪成功；浅色现值不改（只加 dark 覆盖/令牌化）；canvas/SVG 几何不动只改颜色；反相陷阱必须显式修。每个子任务文件边界明确，不得越界。

> **Task 依赖：** A 先做（纯 CSS、零风险）。B、C 互不重叠文件，可并行。D 独立、最后做并单独验证视觉。

---

## Task A: index.css 命名类暗色覆盖批

**Files:** Modify `apps/ocp-site-web/src/index.css`（仅新增 `[data-theme='dark']` 规则，不改任何浅色现值）

**模板：** 照已有 `.protocol-chip-*` 的 dark 覆盖（约 L632–656）写法。

- [ ] **Step 1: 追加 product / roadmap / directory 命名类的暗色覆盖**

在 `@layer components` 内、各原规则之后追加（卡片背景已由 `--ocp-porcelain` 自动适配，这里只补 border / shadow / 写死浅色 hex 文字 / 写死浅色 chip）：

```css
  /* ---- product status chips (dark) ---- */
  [data-theme='dark'] .product-status-stable { background: rgba(46,125,87,0.18); color: #7fd6a6; }
  [data-theme='dark'] .product-status-in-progress { background: rgba(46,230,224,0.14); color: #7ff3ef; }
  [data-theme='dark'] .product-status-coming-soon { background: rgba(197,154,50,0.16); color: #e6c878; }

  /* ---- roadmap (dark) ---- */
  [data-theme='dark'] .roadmap-legend { border-color: var(--border-soft); background: var(--surface-glass); color: var(--text-muted); }
  [data-theme='dark'] .roadmap-legend-planned .roadmap-legend-dot { border-color: rgba(255,255,255,0.32); }
  [data-theme='dark'] .roadmap-node { border-color: var(--border-soft); box-shadow: 0 8px 22px rgba(0,0,0,0.5); }
  [data-theme='dark'] .roadmap-phase-body { background: var(--ocp-porcelain); border-color: var(--border-soft); }
  [data-theme='dark'] .roadmap-status-chip-done { background: rgba(46,125,87,0.18); color: #7fd6a6; }
  [data-theme='dark'] .roadmap-status-chip-in-progress { background: rgba(46,230,224,0.14); color: #7ff3ef; }
  [data-theme='dark'] .roadmap-status-chip-planned { background: rgba(255,255,255,0.08); color: var(--text-muted); }
  [data-theme='dark'] .roadmap-item { border-color: var(--border-soft); }
  [data-theme='dark'] .roadmap-item:hover { box-shadow: 0 14px 30px rgba(0,0,0,0.55); }
  [data-theme='dark'] .roadmap-timeline::before { background: linear-gradient(180deg, rgba(46,125,87,0.55) 0%, rgba(46,230,224,0.5) 50%, rgba(255,255,255,0.16) 100%); }

  /* ---- directory: registry / catalog cards (dark) ---- */
  [data-theme='dark'] .registry-card { border-color: var(--border-soft); box-shadow: 0 1px 2px rgba(0,0,0,0.4); }
  [data-theme='dark'] .registry-card:hover { border-color: rgba(46,230,224,0.4); box-shadow: 0 20px 36px rgba(0,0,0,0.55); }
  [data-theme='dark'] .registry-card.is-offline { background: repeating-linear-gradient(135deg, rgba(217,84,54,0.06) 0, rgba(217,84,54,0.06) 6px, transparent 6px, transparent 12px), var(--ocp-porcelain); }
  [data-theme='dark'] .catalog-card-frame { border-color: var(--border-soft); box-shadow: 0 1px 2px rgba(0,0,0,0.4); }
  [data-theme='dark'] .catalog-card:hover .catalog-card-frame { border-color: rgba(46,230,224,0.4); box-shadow: 0 16px 28px rgba(0,0,0,0.5); }
  [data-theme='dark'] .catalog-health-dot { box-shadow: 0 0 0 3px rgba(255,255,255,0.06); }

  /* ---- directory: filters / chips (dark) ---- */
  [data-theme='dark'] .directory-filters { border-color: var(--border-soft); }
  [data-theme='dark'] .directory-chip { border-color: var(--border-soft); background: var(--surface-1); color: var(--text-muted); }
  [data-theme='dark'] .directory-chip:hover { border-color: rgba(46,230,224,0.5); color: var(--ocp-ink); }
  [data-theme='dark'] .directory-chip.is-active { background: var(--ocp-ink); border-color: var(--ocp-ink); color: var(--ocp-paper); }

  /* ---- directory: drawer (dark) ---- */
  [data-theme='dark'] .catalog-drawer { border-left-color: var(--border-soft); box-shadow: -20px 0 60px rgba(0,0,0,0.6); }
  [data-theme='dark'] .catalog-drawer-scrim { background: rgba(0,0,0,0.6); }
```

> 实现者注意：`.directory-topology-grid`/`-glow` 的现值（`rgba(255,255,255,0.04)` 网格、青色 glow）本就为暗底设计 —— 但它们当前显示在 `bg-[var(--ocp-ink)]` 浅色容器上。Task D 会把该容器在暗色下保持深底，届时这两个类的现值正好合适，**本 Task 不动它们**。

- [ ] **Step 2: 构建验证**

Run: `cd apps/ocp-site-web && bun run build`
Expected: PASS。

- [ ] **Step 3: 提交**

```bash
git add apps/ocp-site-web/src/index.css
git commit -m "feat(site): dark overrides for product/roadmap/directory named classes"
```

---

## Task B: Products + Roadmap 页 JSX 令牌化 + 挂 PageTheme

**Files:** Modify `apps/ocp-site-web/src/pages/ProductsPage.tsx`、`apps/ocp-site-web/src/pages/RoadmapPage.tsx`

- [ ] **Step 1: 两页顶层挂 PageTheme**

`import { PageTheme } from '../theme/ThemeContext';`，在各页根元素（ProductsPage 的 `<main className="site-band">`、RoadmapPage 的 `<main className="home-story">`）内最前面渲染 `<PageTheme theme="dark" />`。

- [ ] **Step 2: ProductsPage 令牌化**

- `bg-white` / `bg-white/70`（卡片、按钮容器）→ `bg-[var(--surface-1)]` 或加 `glass-card`（按是实卡还是浅面判断）。
- `text-black/65`、`/62`、`/72`、`/50` → `text-[var(--text-muted)]`（≥60%）或 `text-[var(--text-faint)]`（≤55%）。
- `border-black/10`、`/12` → `border-[var(--border-soft)]`。
- `bg-[var(--ocp-ink)] text-[var(--ocp-paper)]` 的强调徽标（如 L124）：小徽标反相可接受，**保留**。
- 不改文案、产品数据、Link to、布局类。

- [ ] **Step 3: RoadmapPage 令牌化 + 三处反相陷阱**

- 普通文字/边框/`bg-white` tag 同 Step 2 令牌化。
- **反相陷阱① hero 遮罩**：把写死的浅米渐变（约 L46，`rgba(246,247,242,0.97...)`）改为暗色遮罩，例如 `bg-[linear-gradient(90deg,rgba(2,2,3,0.96)_0%,rgba(2,2,3,0.82)_45%,rgba(2,2,3,0.35)_72%,rgba(2,2,3,0.05)_100%)]`（与首页 hero 同款思路）。hero 背景图 opacity 降到 ~0.35，可叠加一层 `<div className="ambient-field" aria-hidden />`。
- **反相陷阱② 底部 CTA 块**（约 L127，`bg-[var(--ocp-ink)] text-[var(--ocp-paper)]` + 内部 `text-white/xx`/`border-white/25`/`bg-white/10`）：改为 `glass-card`，文字从 `text-[var(--ocp-paper)]`（黑字）改为继承近白或 `text-[var(--text-strong)]`，次要文字 `text-[var(--text-muted)]`，其中若有近黑实底 CTA 按钮改 `bg-white text-[#050608]`（与首页一致）。`text-white/xx`/`border-white/25`/`bg-white/10` 这些本为深底写的，在 glass-card 上仍成立，保留即可。
- ProtocolRelayCanvas 不动（主题无关）。

- [ ] **Step 4: 类型检查 + 构建**

Run: `cd apps/ocp-site-web && bun run typecheck && bun run build`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/ocp-site-web/src/pages/ProductsPage.tsx apps/ocp-site-web/src/pages/RoadmapPage.tsx
git commit -m "feat(site): dark immersive Products and Roadmap pages"
```

---

## Task C: Directory 卡片/抽屉/过滤器 JSX 令牌化 + 挂 PageTheme

**Files:** Modify `apps/ocp-site-web/src/pages/ProductOcpCatalogPage.tsx`、`apps/ocp-site-web/src/components/directory/DirectoryExplorer.tsx`、`DirectoryFilters.tsx`、`CatalogCard.tsx`、`RegistryCard.tsx`、`CatalogDrawer.tsx`
（**不含** `DirectoryTopology.tsx` —— 留 Task D）

- [ ] **Step 1: ProductOcpCatalogPage 挂 PageTheme**

`import { PageTheme }`，在页面根元素内最前面渲染 `<PageTheme theme="dark" />`。页面外层已是 `bg-[var(--ocp-paper)]`（自动变黑），保留。CTA `bg-[var(--ocp-ink)]` 小徽标/按钮反相可接受。

- [ ] **Step 2: 逐组件令牌化（DirectoryExplorer / DirectoryFilters / CatalogCard / RegistryCard / CatalogDrawer）**

统一规则：
- `bg-white`（实卡/输入框/按钮底）→ `bg-[var(--surface-1)]`（输入/浅面）或 `bg-[var(--ocp-porcelain)]`（卡片）。
- `text-black/xx` → `text-[var(--text-strong)]`(≥80%) / `text-[var(--text-muted)]`(60~75%) / `text-[var(--text-faint)]`(≤55%)。
- `border-black/xx` → `border-[var(--border-soft)]`。
- `bg-black/[0.0x]` chips → `bg-[var(--surface-1)]`。
- `placeholder:text-black/40` → `placeholder:text-[var(--text-faint)]`。
- **CatalogCard.tsx 的 JS 内联色**：`healthTone()` 的浅色 fallback、trust 空格 `rgba(20,20,20,0.12)` → 改用 `var(--border-soft)` 或语义令牌（保证暗底可见）。
- `bg-[var(--ocp-ink)] text-[var(--ocp-paper)]` 小徽章（如 Drawer method L301）：保留（反相 OK）。
- code 块写死浅绿 `text-[#cfe6c4]`（Drawer L384）：底是 `--ocp-code`（暗色已更深），保留。
- 不改数据 hook、map 逻辑、props、抽屉开合逻辑、文案。

> CatalogDrawer 文字密度最高（~25 处），逐行过，勿遗漏。

- [ ] **Step 3: 类型检查 + 构建**

Run: `cd apps/ocp-site-web && bun run typecheck && bun run build`
Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add apps/ocp-site-web/src/pages/ProductOcpCatalogPage.tsx apps/ocp-site-web/src/components/directory/DirectoryExplorer.tsx apps/ocp-site-web/src/components/directory/DirectoryFilters.tsx apps/ocp-site-web/src/components/directory/CatalogCard.tsx apps/ocp-site-web/src/components/directory/RegistryCard.tsx apps/ocp-site-web/src/components/directory/CatalogDrawer.tsx
git commit -m "feat(site): dark immersive directory cards, filters, drawer"
```

---

## Task D: DirectoryTopology 专项（反相陷阱 + JS/SVG 内联色）

**Files:** Modify `apps/ocp-site-web/src/components/directory/DirectoryTopology.tsx`（必要时 `index.css` 补 `.directory-topology` 容器暗色）

设计意图：拓扑图容器当前用 `bg-[var(--ocp-ink)]` 作深底（内部 SVG 网格/文字/glow 全是白/青色，为暗底而设）。暗色下 ink 反相成白 → 整图破坏。修法：暗色下让容器**保持深底**。

- [ ] **Step 1: 容器暗色保持深底**

把容器的 `bg-[var(--ocp-ink)]`（约 L81）处理为：浅色下仍是深底（原值），暗色下也保持深底——最简做法是改用一个固定深色（如 `bg-[#05070a]`）或 `bg-[var(--ocp-porcelain)]`，使其不随 `--ocp-ink` 反相。优先用不反相的固定深色，保证浅/暗下拓扑图都是「深底 + 白/青绘制」。

> 判断：该拓扑块本质是「无论页面明暗，都是一块深色可视化面板」。所以用固定深色最正确（语义=深色可视化容器），而非令牌反相。

- [ ] **Step 2: JS 内联色令牌化**

`trustColor.none='rgba(20,20,20,0.42)'`（约 L20，浅色专用，深底上不可见）→ 改为在深底上可见的值，如 `'rgba(255,255,255,0.42)'` 或 `var(--border-soft)` 思路的浅色（因为容器恒为深底，这里应始终用浅色描边）。SVG 其它 `fill="rgba(255,255,255,...)"` 本就为深底设计，保留。**几何/path/viewBox/坐标一律不动。**

- [ ] **Step 3: 类型检查 + 构建**

Run: `cd apps/ocp-site-web && bun run typecheck && bun run build`
Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add apps/ocp-site-web/src/components/directory/DirectoryTopology.tsx apps/ocp-site-web/src/index.css
git commit -m "fix(site): keep directory topology dark-surfaced under dark theme"
```

---

## Task E: Review + 集成验证

**Files:** 无（审查 + 验证）

- [ ] **Step 1: Review Agent 审查 Task A–D 全部变更**

重点：浅色零回归、无兜底/吞错、无写死本可令牌化色、三处反相陷阱已修、canvas/SVG 几何未动、命名类覆盖无遗漏。

- [ ] **Step 2: 全量自动验证**

Run: `cd apps/ocp-site-web && bun run typecheck && bun run build && bun test`
Expected: 全 PASS。

- [ ] **Step 3: dev 人工核对**

`bun run dev`，确认：
1. `/products`、`/products/ocp-catalog`、`/roadmap` 三页均暗色沉浸，无白块/白底卡/亮带。
2. 目录浏览器：拓扑图深底正常（白/青绘制可见）、注册/Catalog 卡片暗色玻璃、过滤器/chip 暗色、点开 Catalog 抽屉暗色且文字可读、scrim 正常。
3. roadmap：hero 暗色遮罩正常、时间线节点/卡片/状态 chip 暗色、底部 CTA 暗玻璃。
4. 三页顶栏/页脚暗色；点进 /docs、/updates 恢复浅色、无闪烁。
5. EN/中文、移动端窄屏正常。
6. console 无新增报错。

- [ ] **Step 4: 记录结果，不通过则回对应 Task 修根因。**

---

## 阶段二完成判定

- typecheck/build/test 全绿；人工核对全过；浅色页零回归；三处反相陷阱已修；无兜底/写死绕过令牌。

## 不在阶段二（阶段三）

- 数据/图表组件（LiveActivity / OcpDiagrams / DirectoryExplorer 信息结构 / DirectoryTopology 可视化叙事）的**深度**沉浸重设计。
