# ocp-site-web 暗色主题 · 阶段二 设计

日期：2026-06-09
状态：阶段二 spec（承接阶段一已落地的暗色设计系统）

## 1. 目标

把剩余三个营销页改造成暗色沉浸风，与已完成的首页一致：
- `ProductsPage`（/products）
- `ProductOcpCatalogPage` + directory 组件（/products/ocp-catalog）
- `RoadmapPage`（/roadmap）

## 2. 已有基础（阶段一，不重复建设）

- 暗色令牌作用域 `[data-theme='dark']`（`--ocp-paper`=#020203、`--ocp-porcelain`=#08090b、`--ocp-ink`=近白反相、`--ocp-cyan`=#2ee6e0、`--surface-1/glass`、`--border-soft`、`--text-strong/muted/faint`）。
- 基础类 `.glass-card / .glass-chip / .ambient-field / .site-band-dark`。
- 主题切换：页面顶层挂 `<PageTheme theme="dark" />`，挂载即暗、卸载复位浅，无竞态。
- 暗色覆盖模板：`index.css` 里 `.protocol-chip-*` 的 5 条 `[data-theme='dark']` 覆盖（L632–656）是本阶段所有命名类覆盖的范本。

## 3. 关键设计判断（基于 Research 结论）

### 3.1 三类工作

1. **index.css 命名类「暗色覆盖批」**（改 CSS，不碰 JSX）：卡片**背景**已因 `--ocp-porcelain` 重赋自动变黑，只需补 border / shadow / 写死的浅色 hex 文字。涉及类：
   - product：`.product-status-stable/-in-progress/-coming-soon`
   - roadmap：`.roadmap-legend*`、`.roadmap-phase-body`、`.roadmap-node`(border/shadow)、`.roadmap-status-chip-*`
   - directory：`.registry-card`(border/shadow)、`.catalog-card-frame`(border/shadow)、`.catalog-health-dot`/`.catalog-trust-cell`、`.directory-filters`、`.directory-chip`(+`.is-active`)、`.catalog-drawer`(border/shadow)、`.catalog-drawer-scrim`、`.directory-topology-grid`/`-glow`（确认其本就为暗底设计的值是否仍合适）
2. **JSX 令牌化**（改 .tsx）：`bg-white`→`bg-[var(--surface-1)]`/`porcelain`、`text-black/xx`→`text-[var(--text-muted/faint)]`、`border-black/xx`→`border-[var(--border-soft)]`、`bg-black/[0.0x]` chips→`bg-[var(--surface-1)]`。大头在 `CatalogDrawer`(~25)、`CatalogCard`(~12)。
3. **JS/SVG 内联色 + 反相陷阱**（硬骨头，需专项）。

### 3.2 三处「反相陷阱」（必须显式处理）

某些元素当初用 `bg-[var(--ocp-ink)]` 作为**深底**设计（配 white 文字/边框）。暗色下 `--ocp-ink` 反相成近白 → 变白底，内部 white 文字消失。必须在暗色下**强制保持深底**（用固定深色或 `--ocp-porcelain`，不让其跟随 ink 反相）：

1. **DirectoryTopology 容器**（`DirectoryTopology.tsx` 容器 `bg-[var(--ocp-ink)]`）：其内 SVG 网格/文字/glow 全是为暗底设计的白/青色。暗色下容器必须保持深底（如固定 `#05070a` 或 `--ocp-porcelain`），否则整张拓扑图反相破坏。
2. **Roadmap 底部 CTA 块**（`RoadmapPage.tsx` `bg-[var(--ocp-ink)] text-[var(--ocp-paper)]` + 内部 `text-white/xx`、`border-white/25`、`bg-white/10`）：暗色下强制保持深底 + 保留 white 文字，或改 `glass-card`。
3. **Roadmap hero 遮罩**（`RoadmapPage.tsx` 写死浅米渐变 `rgba(246,247,242,0.97…)`）：暗色下必须换深色遮罩 `rgba(2,2,3,…)`，否则盖白整个 hero。

小徽标的 ink 反相（ProductsPage 徽标、OcpCatalog CTA、Drawer method 徽章）**可接受**（反相成亮底暗字的小 pill，语义正确），不在陷阱清单。

### 3.3 JS 内联色令牌化

- `DirectoryTopology.tsx`：`trustColor.none='rgba(20,20,20,0.42)'`（浅色专用，暗底不可见）。
- `CatalogCard.tsx`：`healthTone()` fallback 与 trust 空格 `rgba(20,20,20,0.12)`。
  这些改用 CSS 变量（`var(--border-soft)` 等）或在暗色下提供合适值。SVG 几何/path/viewBox 一律不动。

### 3.4 ProtocolRelayCanvas（共享组件）

经核对：canvas 用品牌饱和色（cyan/gold/green）绘制，明暗皆可读；仅有一处粒子高光 `#f6f7f2`（亮点）。**判定为主题无关，无需改动**。Roadmap hero 只需处理 3.2-3 的遮罩。

## 4. 错误处理 / 约束

- 浅色现值零回归：只新增 `[data-theme='dark']` 覆盖与令牌化（浅色 else 分支保原值）。
- 反相陷阱必须显式修，不得放任白块。
- 无兜底、无吞错、无新旧双实现、不写死本可令牌化的颜色。
- canvas/SVG 几何不动，只改颜色字面量。

## 5. 验证

- `typecheck` / `build` / `bun test` 全绿。
- dev 人工核对：三页均暗色沉浸、无白块/亮带；拓扑图深底正常；roadmap hero 与底部 CTA 正常；浅色文档/新闻页不受影响；明暗切换无闪烁；EN/中文、移动端正常。

## 6. 不在阶段二

- 数据组件（LiveActivity/OcpDiagrams/DirectoryExplorer 等）的**深度**沉浸重设计仍属阶段三——阶段二只做令牌化「不破相 + 风格统一」，不重构其信息结构与视觉叙事。
