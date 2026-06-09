# ocp-site-web 暗色沉浸主题改造 — 设计文档

日期：2026-06-09
状态：阶段一 spec（已与用户确认大方向）

## 1. 目标

把 `apps/ocp-site-web` 从现在的「纸白 / 墨黑 + 青绿」浅色风格，改造成 Collov（collov.com）式的**暗色、沉浸、玻璃磨砂**风格。

### 已确认的方向决策

| 维度 | 决策 |
| --- | --- |
| 范围 | 营销页（首页、Products、Products/OCP-Catalog、Roadmap）→ 暗色；文档与新闻（Docs、Updates、各 PageView）→ **保持浅色** |
| 共享框架 | 顶栏 / 页脚做成「随页面明暗自适应」（暗色页显暗、浅色页显浅） |
| 色调 | **青绿冷调**，延续现有 `#00a7a5` 品牌色：近黑底 + 白字 + 青绿/深蓝雾光 |
| 强度 | **深度重做**——营销页做成全屏沉浸式叙事 |
| 板块范围 | 全部重做，含数据/图表板块（实时活动流、SVG 示意图、目录浏览器） |

### 分阶段交付（控制风险）

整体工作量约 4000 行组件 + 1242 行 CSS，过大无法一次落地。拆为三个独立可验收阶段：

- **阶段一（本 spec）**：暗色设计系统底座 + 主题上下文 + 自适应顶栏/页脚 + **首页全屏沉浸重做**。
- **阶段二**（后续 spec）：Products / Products-OCP-Catalog（目录浏览器）/ Roadmap 三个营销页的沉浸式重做。
- **阶段三**（后续 spec）：数据/图表组件（OcpDiagrams、LiveActivity、ProtocolRelayCanvas、DirectoryExplorer 等）较重的暗色沉浸重设计。

本文档只详细规定**阶段一**。阶段二、三在阶段一落地、风格被验证后，各自再写独立 spec。

## 2. 现状（基线）

- 技术栈：React 19 + react-router-dom 7 + Tailwind 3.4 +（`@tailwindcss/typography`）。Vite 8 / Bun。
- 设计系统集中在 `src/index.css`（1242 行）：
  - `:root` 定义浅色令牌：`--ocp-ink:#141414`、`--ocp-paper:#f6f7f2`、`--ocp-porcelain:#fff`、`--ocp-cyan:#00a7a5`、`--ocp-vermilion`、`--ocp-green`、`--ocp-gold`、`--ocp-code`。
  - `body` 用浅色径向 + 线性渐变背景。
  - 大量 `@layer components` 自定义类：`.site-band`、`.section-kicker`、`.flow-card`、`.builder-card`、`.protocol-chip-*`、hero 动效（`.hero-bg/.hero-sweep/.hero-beacon/.hero-scanline/.hero-orbit-card/.hero-status-row/.hero-scroll-cue`）、滚动联动（`.reveal-on-scroll`、`.hero-parallax-*`）、右侧浮动 section 导航（`.home-section-nav`）、roadmap 时间线、directory 卡片等。
- `SiteLayout`（`src/layouts/SiteLayout.tsx`）：所有路由共享的 sticky 顶栏 + 页脚，**当前为浅色硬编码**（`bg-[rgba(246,247,242,0.88)]`、`text-black/...` 等）。顶栏含 logo、导航、EN/中文切换、移动端菜单。
- `HomePage`（`src/pages/HomePage.tsx`，451 行）：8 个 section —— `hero / flow / live / glance / why / open / onboarding / paths`，含右侧浮动 section rail、rAF 视差、IntersectionObserver 高亮、`reveal-on-scroll`。
- 内容来自 i18n（`useDocsLocale`），EN/中文双语，**所有现有文案与结构必须保留**。
- hero 背景图：`public/images/site/home-hero-protocol-relay.png`，另有 `home-commerce-object-stack.png`、`provider-onboarding-scene.png`、`updates-release-ledger.png`。
- 已实现 `prefers-reduced-motion` 全局降级（`index.css` 末尾）。

## 3. 设计

### 3.1 主题架构：双主题令牌 + 上下文驱动

核心思路：**不破坏文档页的浅色体系，新增一套暗色令牌，用一个 `data-theme` 属性在 marketing 页面切换。**

引入主题作用域，而非全局改 `:root`：

```css
/* 浅色（默认，文档/新闻沿用，等价于现状） */
:root,
[data-theme='light'] {
  --ocp-ink: #141414;
  --ocp-paper: #f6f7f2;
  --ocp-porcelain: #ffffff;
  --ocp-cyan: #00a7a5;
  /* …其余沿用现值 */
  --surface-1: ...;       /* 卡片底 */
  --surface-glass: ...;   /* 毛玻璃面 */
  --border-soft: ...;
  --text-strong / --text-muted / --text-faint;
}

/* 暗色（青绿冷调，marketing 页用） */
[data-theme='dark'] {
  --ocp-ink: #f4f5f2;          /* 注意：暗色下 ink/paper 语义对调，使复用现有类时颜色自动反相 */
  --ocp-paper: #050608;
  --ocp-porcelain: #0c0f12;
  --ocp-cyan: #2ee6e0;         /* 暗底上提亮的青绿，保证对比度 */
  --ocp-cyan-deep: #00a7a5;
  --surface-1: rgba(255,255,255,0.04);
  --surface-glass: rgba(255,255,255,0.06);
  --border-soft: rgba(255,255,255,0.10);
  --text-strong: #f4f5f2;
  --text-muted: rgba(244,245,242,0.70);
  --text-faint: rgba(244,245,242,0.50);
  color-scheme: dark;
}
```

> 设计取舍：暗色下把 `--ocp-ink` 设为浅色、`--ocp-paper` 设为近黑，这样**已经用 `var(--ocp-ink)`/`var(--ocp-paper)` 的组件在暗色作用域里自动反相**，减少逐处改写。但凡是写死 `text-black/xx`、`bg-white/xx` 的地方仍需替换为令牌或 `dark:` 工具类——这部分在重做组件时一并处理。

**怎么挂 `data-theme`**：新增一个极轻的 `ThemeContext` + `<ThemeScope theme="dark">` 包裹组件（或直接在页面根 `div` 上 `data-theme`）。`SiteLayout` 读取当前 theme 决定顶栏/页脚配色。实现细节：

- 新建 `src/theme/ThemeContext.tsx`：`ThemeProvider` 持有 `theme: 'light' | 'dark'`，默认 `light`；提供 `useTheme()` 与 `<PageTheme theme="dark" />`（mount 时设 `document.documentElement.dataset.theme = 'dark'`，unmount/切到浅色页时复位为 `light`，并写 `<meta name="theme-color">`）。
- 每个营销页（本阶段只有 `HomePage`）在顶层渲染 `<PageTheme theme="dark" />`。文档/新闻页不渲染，保持默认浅色。
- `SiteLayout` 通过 `useTheme()` 或读 `document.documentElement.dataset.theme`，给顶栏/页脚切换浅/暗两套 className。

> 为什么用 `documentElement` 上的 `data-theme` 而不是仅局部 div：顶栏是 `sticky` 且在 `<Outlet/>` 之外、与页面同级，必须能感知当前页主题；放在 `html` 上让顶栏、页脚、页面共享同一信号，避免闪烁。路由切换时在 effect 中同步。

### 3.2 玻璃磨砂 + 沉浸背景：两层基底

Collov 的「磨砂沉浸」来自两层，暗色页统一提供：

1. **氛围背景层（ambient）**：大面积失焦光晕。用纯 CSS 多重 `radial-gradient`（青绿 + 深蓝 + 一点冷白）叠加近黑底，配合极慢 drift 动画；不依赖产品照片，避免与「商业对象」语义打架。提供工具类 `.ambient-field`（可调位置变量）。可选叠加现有 hero 图，但**经强模糊 + 暗色蒙版**处理成纯氛围（`filter: blur + brightness`，`mask`/`opacity` 压暗）。
2. **玻璃面层（glass）**：卡片/浮层用 `background: var(--surface-glass)` + `backdrop-filter: blur(14px)` + `1px var(--border-soft)` 描边 + 顶部高光。提供 `.glass-card` / `.glass-chip` 组件类。

辅助：暗色网格线（替换浅色 `.site-band` 的暗色版 `.site-band-dark`，线用 `rgba(255,255,255,0.05)`）。

### 3.3 阶段一交付内容

#### A. 设计系统底座（`src/index.css` + 新增 theme 模块）

1. 拆出暗色令牌作用域（如 3.1）。
2. 新增暗色基础类：`.ambient-field`、`.glass-card`、`.glass-chip`、`.site-band-dark`。
3. 把现有 hero / reveal / rail / chip 等动效类做**暗色适配**：凡写死浅色值（如 `rgba(246,247,242,...)`、`rgba(20,20,20,...)`）的，改用令牌或在 `[data-theme='dark']` 下覆盖，使同一套类在暗色页自然成立。
4. `body` 背景：浅色保持现状；`[data-theme='dark'] body` 用近黑 + 极弱氛围渐变。

#### B. 主题上下文（新增 `src/theme/`）

- `ThemeContext.tsx`：`ThemeProvider`、`useTheme()`、`PageTheme`（副作用设/复位 `html[data-theme]` 与 `meta[theme-color]`）。
- 在 `App.tsx` 用 `ThemeProvider` 包裹 `BrowserRouter`（或 Routes）。

#### C. 自适应顶栏/页脚（改 `SiteLayout.tsx`）

- 读取当前 theme。浅色时**完全维持现状**（零回归）。
- 暗色时：顶栏 `bg-[rgba(5,6,8,0.72)] backdrop-blur-xl border-white/10`，导航文字白/70、active 用青绿玻璃高亮；EN/中文切换、移动菜单同步暗化；右侧加一个白底「Get Started」主按钮（指向 `/docs`，呼应 Collov）。
- 页脚暗色时用近黑 + 白字 + `--border-soft`。
- logo 底色块在暗色下改白底黑标（或反相），保证可见。

#### D. 首页全屏沉浸重做（改 `HomePage.tsx`）

保留 8 个 section 的**内容与 i18n 文案、section id、浮动 rail、IntersectionObserver、视差逻辑**，重做视觉：

- **hero**：整屏（`min-h-[100vh-headerh]`）氛围背景（`.ambient-field` + 强模糊处理后的 hero 图叠加）；大标题白字，可保留/改造现有渐变扫光为青绿扫光；副文案白/70；主 CTA 白底黑字「Get Started」，次 CTA 玻璃描边；规模指标卡改 `.glass-card`。右侧 `LiveActivityPulse` 暂时仅做暗色适配（深做留阶段三）。
- **flow（五步）**：卡片改玻璃卡 + 暗色；序号块反相；hover 青绿描边沿用 `.flow-card` 思路的暗色版。
- **live / glance / onboarding**：本阶段做**暗色换肤**（容器、边框、文字令牌化），其内部数据组件（LiveActivitySection、OcpDiagrams、OnboardingScenePanel）的**深度重设计明确推迟到阶段三**——本阶段只保证它们在暗底上可读、不破坏（必要时给一层玻璃容器包裹）。
- **why / open / paths**：文字营销板块，做成沉浸式暗色叙事（大字、氛围背景带、玻璃 chip、`.builder-card` 暗色版）。
- 右侧 section rail：`.home-section-nav` 暗色化（轨道/圆点/标签用白系 + 青绿 active）。

### 3.4 单元边界

- `src/theme/ThemeContext.tsx`：**只**负责主题状态与 `html[data-theme]`/`meta` 副作用。输入：`theme` prop；输出：context + DOM 副作用。不含样式。
- `index.css` 令牌层：**只**定义两套令牌与基础类。组件不再写死颜色，一律用令牌/`dark:`。
- `SiteLayout`：消费 `useTheme()`，在两套 className 间切换。结构不变。
- `HomePage`：消费暗色令牌与新基础类，结构/逻辑不变，仅换视觉。

如此，改 `HomePage` 视觉不影响主题机制；调令牌不必动组件 JSX；文档页因不挂 `data-theme=dark` 而完全不受影响。

## 4. 错误处理 / 兼容

- **浅色零回归**：文档/新闻页不挂暗色 theme，`:root` 浅色令牌与现有类原值保留；改造时不得修改浅色作用域的现值（只新增暗色覆盖）。
- **路由切换闪烁与复位**：采用「声明式 + 路由复位」机制，避免依赖各浅色页主动声明：
  - `ThemeProvider` 监听 `useLocation()`，**每次 pathname 变化时先把 `html[data-theme]` 复位为 `light`**（默认即浅色）。
  - 暗色页通过渲染 `<PageTheme theme="dark" />` 在其 mount effect 中把 `data-theme` 设为 `dark`。由于复位发生在路由变化（同一渲染周期更早或 layout effect 顺序保证），且 `PageTheme` 用 `useLayoutEffect` 设值，暗色页进入时一次性置暗、离开时随路由复位为浅 → 文档/新闻页无需任何改动即默认浅色，且无暗→浅残留。
  - 初始 SSR/首帧：`index.html` 或 `App` 根默认 `light`，首帧即正确。
- **对比度**：暗底正文用 `--text-muted`（70% 白）起步，标题 100%；青绿在暗底用提亮值 `#2ee6e0` 保证 AA。
- **`prefers-reduced-motion`**：沿用现有全局降级；新增氛围 drift 动画也纳入降级（静止）。
- **`backdrop-filter` 回退**：不支持的浏览器降级为半透明实底（`@supports not (backdrop-filter: blur(1px))` 提供 fallback 背景）。

## 5. 验证方式

- `bun run typecheck` 通过。
- `bun run build` 通过。
- `bun run dev` 人工核对：
  - 首页为暗色沉浸风，8 个 section 均可读、rail/视差/reveal 正常。
  - 顶栏/页脚在首页为暗色；点进 `/docs`、`/updates` 后顶栏/页脚与页面恢复浅色，无残留暗色、无闪烁。
  - EN ↔ 中文切换文案正确，双语下暗色排版都成立。
  - 缩小到移动端：移动菜单暗色正确；`prefers-reduced-motion` 下动画静止。
- 不引入对比度过低（白底黑字/暗底暗字）的明显可读性问题。

## 6. 明确不在阶段一范围

- Products / Products-OCP-Catalog / Roadmap 页面的沉浸重做（阶段二）。
- LiveActivitySection / OcpDiagrams / ProtocolRelayCanvas / DirectoryExplorer 等数据/图表组件的**深度**沉浸重设计（阶段三）——阶段一只做让它们在暗底上不破相的换肤。
- 文档/新闻页任何视觉改动（保持浅色现状）。
- 新增背景图片素材的设计/采购（阶段一用纯 CSS 氛围层 + 复用现有图的模糊处理）。
