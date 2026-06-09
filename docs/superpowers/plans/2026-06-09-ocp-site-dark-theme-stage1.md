# OCP Site 暗色沉浸主题 · 阶段一 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 ocp-site-web 建立暗色双主题令牌系统与上下文驱动机制，让首页与共享顶栏/页脚切换为 Collov 式青绿冷调暗色沉浸风，文档/新闻页保持浅色零回归。

**Architecture:** 不改全局 `:root` 浅色值；新增 `[data-theme='dark']` 令牌作用域。新增极轻的 `ThemeProvider`，把主题写到 `document.documentElement.dataset.theme`：路由变化默认复位 `light`，营销页通过 `<PageTheme theme="dark">` 用 `useLayoutEffect` 置暗。主题解析逻辑抽成纯函数单测；DOM 副作用与视觉层用构建 + 人工核对验证。组件不写死颜色，一律用令牌或 `dark:` 工具类。

**Tech Stack:** React 19, react-router-dom 7, Tailwind 3.4, Vite 8, Bun（`bun test`）。

> **执行约束（Commander 工程原则）：** 禁止兜底代码 / 吞错 / 伪成功；不保留新旧双实现；浅色作用域现值不得修改（只新增暗色覆盖）；每个 Implementation 子任务有明确文件边界，不得越界。视觉任务用「构建通过 + 明确人工核对清单」验证，禁止为通过测试而削弱断言。

---

## 文件结构（本阶段创建/修改）

**创建：**
- `apps/ocp-site-web/src/theme/theme.ts` — 纯逻辑：`Theme` 类型、`DEFAULT_THEME`、`resolveTheme(declared)` 主题解析纯函数（路由复位由 `ThemeProvider` 的 effect 处理，不进纯函数）。无 DOM、无 React。
- `apps/ocp-site-web/src/theme/theme.test.ts` — `theme.ts` 的 bun 单测。
- `apps/ocp-site-web/src/theme/ThemeContext.tsx` — `ThemeProvider`、`useTheme()`、`PageTheme`。只管主题状态与 `html[data-theme]`/`meta[theme-color]` 副作用，不含样式。

**修改：**
- `apps/ocp-site-web/src/index.css` — 新增暗色令牌作用域 + 基础类（`.ambient-field`、`.glass-card`、`.glass-chip`、`.site-band-dark`）+ 现有动效类暗色适配。**不改浅色现值。**
- `apps/ocp-site-web/src/App.tsx` — 用 `ThemeProvider` 包裹路由。
- `apps/ocp-site-web/src/layouts/SiteLayout.tsx` — 顶栏/页脚消费 `useTheme()`，浅色维持现状、暗色暗化。
- `apps/ocp-site-web/src/pages/HomePage.tsx` — 顶层挂 `<PageTheme theme="dark" />`，8 个 section 视觉令牌化重做。

---

## Task 1: 主题解析纯函数 + 单测

**Files:**
- Create: `apps/ocp-site-web/src/theme/theme.ts`
- Test: `apps/ocp-site-web/src/theme/theme.test.ts`

设计意图：把「当前应是什么主题」做成无副作用纯函数，便于单测；DOM 应用在 Task 2 的 effect 里调用它。`declared` 表示当前已挂载页面是否显式声明了主题（营销页声明 `'dark'`，其余页传 `null`）。

- [ ] **Step 1: 写失败测试**

```ts
// apps/ocp-site-web/src/theme/theme.test.ts
import { describe, it, expect } from 'bun:test';
import { resolveTheme, DEFAULT_THEME } from './theme';

describe('resolveTheme', () => {
  it('defaults to light when no page declares a theme', () => {
    expect(resolveTheme(null)).toBe('light');
    expect(DEFAULT_THEME).toBe('light');
  });

  it('uses the declared theme when a page declares one', () => {
    expect(resolveTheme('dark')).toBe('dark');
    expect(resolveTheme('light')).toBe('light');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/ocp-site-web && bun test src/theme/theme.test.ts`
Expected: FAIL — `Cannot find module './theme'`。

- [ ] **Step 3: 最小实现**

```ts
// apps/ocp-site-web/src/theme/theme.ts
export type Theme = 'light' | 'dark';

export const DEFAULT_THEME: Theme = 'light';

/**
 * 解析当前应生效的主题。
 * @param declared 当前已挂载页面显式声明的主题；未声明传 null（默认浅色）。
 */
export function resolveTheme(declared: Theme | null): Theme {
  return declared ?? DEFAULT_THEME;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/ocp-site-web && bun test src/theme/theme.test.ts`
Expected: PASS（2 tests）。

- [ ] **Step 5: 提交**

```bash
git add apps/ocp-site-web/src/theme/theme.ts apps/ocp-site-web/src/theme/theme.test.ts
git commit -m "feat(site): add pure theme resolver for dark/light"
```

---

## Task 2: ThemeProvider / useTheme / PageTheme

**Files:**
- Create: `apps/ocp-site-web/src/theme/ThemeContext.tsx`
- Modify: `apps/ocp-site-web/src/App.tsx`

设计意图：`ThemeProvider` 持有当前主题 state 并把它写到 `document.documentElement.dataset.theme` 与 `<meta name="theme-color">`；`PageTheme` 让营销页声明 `'dark'`；`useTheme()` 给 `SiteLayout` 读当前主题切换配色。路由变化时默认复位浅色（在 `ThemeProvider` 监听 `useLocation`），暗色页用 `useLayoutEffect` 抢在 paint 前置暗，避免闪烁。

> 无兜底：`useTheme()` 在 Provider 外调用直接 `throw`，不返回默认值——防止误用被静默掩盖。

- [ ] **Step 1: 实现 ThemeContext**

```tsx
// apps/ocp-site-web/src/theme/ThemeContext.tsx
import {
  createContext,
  useContext,
  useState,
  useLayoutEffect,
  useEffect,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router-dom';
import { DEFAULT_THEME, type Theme } from './theme';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const THEME_COLORS: Record<Theme, string> = {
  light: '#f6f7f2',
  dark: '#050608',
};

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = THEME_COLORS[theme];
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  const location = useLocation();

  // 每次路由变化默认复位为浅色；声明暗色的页面会在其 PageTheme 中重新置暗。
  useLayoutEffect(() => {
    setTheme(DEFAULT_THEME);
  }, [location.pathname]);

  // 把当前主题同步到 <html data-theme> 与 meta。
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}

/**
 * 由营销页在顶层渲染：声明该页应使用的主题。
 * 用 useLayoutEffect 抢在 paint 前置主题，避免与路由复位竞态产生闪烁。
 */
export function PageTheme({ theme }: { theme: Theme }) {
  const { setTheme } = useTheme();
  useLayoutEffect(() => {
    setTheme(theme);
  }, [theme, setTheme]);
  return null;
}
```

- [ ] **Step 2: 在 App.tsx 包裹路由**

把 `App.tsx` 改为用 `ThemeProvider` 包裹路由内容。注意 `ThemeProvider` 用了 `useLocation`，**必须在 `<BrowserRouter>` 内部**：

```tsx
// apps/ocp-site-web/src/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './theme/ThemeContext';
import { SiteLayout } from './layouts/SiteLayout';
import { DocsLayout } from './components/docs/DocsLayout';
import { HomePage } from './pages/HomePage';
import { DocsLandingPage } from './pages/DocsLandingPage';
import { UpdatesPage } from './pages/UpdatesPage';
import { UpdateDetailPage } from './pages/UpdateDetailPage';
import { ProductsPage } from './pages/ProductsPage';
import { ProductOcpCatalogPage } from './pages/ProductOcpCatalogPage';
import { RoadmapPage } from './pages/RoadmapPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PageView } from './pages/PageView';

function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <Routes>
          <Route path="/" element={<SiteLayout />}>
            <Route index element={<HomePage />} />
            <Route path="docs" element={<DocsLandingPage />} />
            <Route path="docs/*" element={<DocsLayout />}>
              <Route path="*" element={<PageView />} />
            </Route>
            <Route path="updates" element={<UpdatesPage />} />
            <Route path="updates/:slug" element={<UpdateDetailPage />} />
            <Route path="products" element={<ProductsPage />} />
            <Route path="products/ocp-catalog" element={<ProductOcpCatalogPage />} />
            <Route path="directory" element={<Navigate to="/products/ocp-catalog" replace />} />
            <Route path="roadmap" element={<RoadmapPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
          <Route path="/zh" element={<SiteLayout />}>
            <Route index element={<HomePage />} />
            <Route path="docs" element={<DocsLandingPage />} />
            <Route path="docs/*" element={<DocsLayout />}>
              <Route path="*" element={<PageView />} />
            </Route>
            <Route path="updates" element={<UpdatesPage />} />
            <Route path="updates/:slug" element={<UpdateDetailPage />} />
            <Route path="products" element={<ProductsPage />} />
            <Route path="products/ocp-catalog" element={<ProductOcpCatalogPage />} />
            <Route path="directory" element={<Navigate to="/zh/products/ocp-catalog" replace />} />
            <Route path="roadmap" element={<RoadmapPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export default App;
```

- [ ] **Step 3: 类型检查 + 构建**

Run: `cd apps/ocp-site-web && bun run typecheck`
Expected: PASS（无类型错误）。

- [ ] **Step 4: 提交**

```bash
git add apps/ocp-site-web/src/theme/ThemeContext.tsx apps/ocp-site-web/src/App.tsx
git commit -m "feat(site): add ThemeProvider with route-reset + PageTheme"
```

---

## Task 3: 暗色令牌作用域 + 基础类（index.css）

**Files:**
- Modify: `apps/ocp-site-web/src/index.css`

设计意图：浅色 `:root` 现值**一律不动**，只新增 `[data-theme='dark']` 覆盖与暗色基础类。暗色下 `--ocp-ink`/`--ocp-paper` 语义对调，使复用 `var(--ocp-ink/paper)` 的现有组件自动反相。

- [ ] **Step 1: 在 `@layer base` 的 `:root` 之后新增暗色作用域**

在现有 `:root { ... }` 块**之后**（不修改其中任何一行），插入：

```css
  [data-theme='dark'] {
    /* 语义对调：现有用 var(--ocp-ink)/var(--ocp-paper) 的组件自动反相 */
    --ocp-ink: #f4f5f2;
    --ocp-paper: #050608;
    --ocp-porcelain: #0c0f12;
    --ocp-graphite: #c7ccc4;
    --ocp-cyan: #2ee6e0;        /* 暗底提亮青绿，保证对比度 */
    --ocp-cyan-deep: #00a7a5;
    --ocp-code: #04060a;
    /* 新增语义令牌（浅色作用域也应补一份，见 Step 2） */
    --surface-1: rgba(255, 255, 255, 0.04);
    --surface-glass: rgba(255, 255, 255, 0.06);
    --border-soft: rgba(255, 255, 255, 0.10);
    --text-strong: #f4f5f2;
    --text-muted: rgba(244, 245, 242, 0.70);
    --text-faint: rgba(244, 245, 242, 0.50);
    color-scheme: dark;
  }
```

- [ ] **Step 2: 给浅色 `:root` 补充新增语义令牌（追加，不改现有行）**

在 `:root { ... }` 块内**末尾追加**这几行（现有令牌一行不动）：

```css
    --surface-1: #ffffff;
    --surface-glass: rgba(255, 255, 255, 0.72);
    --border-soft: rgba(20, 20, 20, 0.10);
    --text-strong: #141414;
    --text-muted: rgba(20, 20, 20, 0.66);
    --text-faint: rgba(20, 20, 20, 0.50);
```

- [ ] **Step 3: 暗色 body 背景 + 氛围/玻璃基础类**

在 `@layer base` 末尾（`code, pre` 规则之后）追加暗色 body 背景：

```css
  [data-theme='dark'] body {
    background:
      radial-gradient(circle at 72% 30%, rgba(0, 167, 165, 0.16), transparent 38%),
      radial-gradient(circle at 24% 74%, rgba(40, 90, 140, 0.14), transparent 46%),
      var(--ocp-paper);
  }
```

在 `@layer components` 内追加基础类：

```css
  /* 失焦氛围光晕背景层（位置可用 --ax/--ay 调） */
  .ambient-field {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      radial-gradient(circle at var(--ax, 72%) var(--ay, 32%), rgba(0, 222, 218, 0.22), transparent 42%),
      radial-gradient(circle at 26% 72%, rgba(40, 90, 140, 0.20), transparent 52%),
      radial-gradient(circle at 50% 50%, rgba(120, 220, 255, 0.08), transparent 64%);
    filter: blur(2px);
    animation: ambient-drift 22s ease-in-out infinite alternate;
  }

  @keyframes ambient-drift {
    from { transform: scale(1.02) translate3d(0, 0, 0); }
    to { transform: scale(1.08) translate3d(-1rem, -0.8rem, 0); }
  }

  /* 暗色网格 */
  .site-band-dark {
    background-image:
      linear-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.05) 1px, transparent 1px);
    background-size: 40px 40px;
  }

  /* 毛玻璃面 */
  .glass-card {
    border: 1px solid var(--border-soft);
    background: var(--surface-glass);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    border-radius: 0.5rem;
  }

  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    [data-theme='dark'] .glass-card {
      background: rgba(12, 15, 18, 0.92);
    }
  }

  .glass-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    border: 1px solid var(--border-soft);
    background: var(--surface-glass);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border-radius: 0.5rem;
    padding: 0.375rem 0.75rem;
  }

  @media (prefers-reduced-motion: reduce) {
    .ambient-field { animation: none; }
  }
```

- [ ] **Step 4: 现有 hero/rail 动效类的暗色适配**

`.hero-scroll-cue` 与 `.home-section-nav` 用了写死浅色值。在 `@layer components` 内、相关规则**之后**追加暗色覆盖（不改原规则）：

```css
  [data-theme='dark'] .hero-scroll-cue {
    border-color: rgba(255, 255, 255, 0.24);
    background: rgba(5, 6, 8, 0.54);
  }
  [data-theme='dark'] .home-section-nav::before {
    background: rgba(255, 255, 255, 0.14);
  }
  [data-theme='dark'] .home-section-nav button {
    color: rgba(244, 245, 242, 0.5);
  }
  [data-theme='dark'] .home-section-nav button:hover,
  [data-theme='dark'] .home-section-nav button.is-active {
    color: var(--ocp-ink);
  }
  [data-theme='dark'] .home-section-nav button::after {
    background: var(--ocp-paper);
    border-color: rgba(255, 255, 255, 0.32);
    box-shadow: 0 0 0 3px var(--ocp-paper);
  }
  [data-theme='dark'] .home-section-nav button.is-active::after {
    background: var(--ocp-cyan);
    border-color: var(--ocp-cyan);
    box-shadow: 0 0 0 3px var(--ocp-paper), 0 0 0 6px rgba(46, 230, 224, 0.18);
  }
```

- [ ] **Step 5: 构建验证**

Run: `cd apps/ocp-site-web && bun run build`
Expected: PASS（tsc + vite build 无错）。

- [ ] **Step 6: 提交**

```bash
git add apps/ocp-site-web/src/index.css
git commit -m "feat(site): add dark theme tokens, glass + ambient base classes"
```

---

## Task 4: 自适应顶栏/页脚（SiteLayout）

**Files:**
- Modify: `apps/ocp-site-web/src/layouts/SiteLayout.tsx`

设计意图：`useTheme()` 读当前主题。**浅色分支必须 byte-for-byte 维持现有 className（零回归）**；暗色分支提供暗化版本。用一个 `dark` 布尔派生 className，避免新旧两套组件并存。

- [ ] **Step 1: 引入 useTheme 并派生 dark 标志**

在 `SiteLayout` 顶部 `import { useTheme } from '../theme/ThemeContext';`，函数体内：

```tsx
const { theme } = useTheme();
const dark = theme === 'dark';
```

- [ ] **Step 2: 顶栏/页脚按 dark 切换 className**

将根 `<header>` 的 sticky 背景类改为条件式（浅色保持原值）：

```tsx
<header
  className={`sticky top-0 z-50 backdrop-blur-xl ${
    dark
      ? 'border-b border-white/10 bg-[rgba(5,6,8,0.72)]'
      : 'border-b border-black/10 bg-[rgba(246,247,242,0.88)]'
  }`}
>
```

导航 active/hover、EN/中文切换按钮、移动菜单、logo 底色块、页脚，同样以 `dark ?` 切换：暗色用 `text-white/70`、active 用 `bg-[rgba(46,230,224,0.14)] text-[var(--ocp-cyan)]`、边框 `border-white/10`、logo 底色块暗色下用 `bg-white`（标记反相为黑）。页脚暗色 `bg-[var(--ocp-paper)] text-[var(--ocp-ink)]`（令牌已反相）、链接 `text-white/66 hover:text-white`。

> 实现者注意：逐个把现有写死的 `bg-[rgba(246,247,242,...)]`、`text-black/xx`、`border-black/10`、`bg-white/70` 包进 `dark ? darkClass : 原className`，**原 className 字符串保持不变**作为浅色分支。

- [ ] **Step 3: 暗色页顶栏加「Get Started」主按钮**

在桌面端 EN/中文切换组旁，仅暗色时渲染一个白底主按钮（呼应 Collov），指向 docs：

```tsx
{dark && (
  <Link
    to={localizePath('/docs')}
    className="hidden rounded-md bg-white px-4 py-2 text-sm font-semibold text-[#050608] transition-transform hover:-translate-y-0.5 md:inline-flex"
  >
    {locale === 'zh' ? '开始使用' : 'Get Started'}
  </Link>
)}
```

- [ ] **Step 4: 类型检查 + 构建**

Run: `cd apps/ocp-site-web && bun run typecheck && bun run build`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/ocp-site-web/src/layouts/SiteLayout.tsx
git commit -m "feat(site): theme-adaptive header/footer (light unchanged, dark variant)"
```

---

## Task 5: 首页沉浸重做（HomePage）

**Files:**
- Modify: `apps/ocp-site-web/src/pages/HomePage.tsx`

设计意图：**保留全部 i18n 文案、section id、浮动 rail、IntersectionObserver、rAF 视差、reveal 逻辑**，只换视觉。挂 `<PageTheme theme="dark" />`。用令牌与新基础类替换写死浅色样式；数据子组件（LiveActivityPulse / LiveActivitySection / OcpDiagrams / OnboardingScenePanel）本阶段仅用玻璃容器包裹保证暗底可读，**深度重做留阶段三**。

- [ ] **Step 1: 顶层挂 PageTheme**

`import { PageTheme } from '../theme/ThemeContext';`，在 `return (<main className="home-story">` 内最前面渲染 `<PageTheme theme="dark" />`。

- [ ] **Step 2: hero 改全屏氛围沉浸**

- hero `<section>` 内的浅色蒙版 `bg-[linear-gradient(90deg,rgba(246,247,242,...))]` 改为暗色蒙版 `bg-[linear-gradient(90deg,rgba(5,6,8,0.96)_0%,rgba(5,6,8,0.85)_42%,rgba(5,6,8,0.35)_70%,rgba(5,6,8,0.05)_100%)]`。
- hero 背景图层叠加 `.ambient-field`（在 `.hero-bg` 之上加一个 `<div className="ambient-field" aria-hidden />`），背景图 `opacity` 降到 `~0.35` 并保留 `.hero-bg` 模糊漂移。
- hero 文案区：徽章 chip 改 `glass-chip text-white/72`；GitHub chip 用 `glass-chip` + 青绿描边 `border-[var(--ocp-cyan)]/40 text-[var(--ocp-cyan)]`；副文案 `text-[var(--text-muted)]`；主 CTA 改白底黑字 `bg-white text-[#050608]`（文案保留「了解 OCP 如何工作 / See how OCP works」），次 CTA 改 `glass-card` 描边白字；规模指标两张卡改 `glass-card` + `text-[var(--text-muted)]` 标签、数值 `text-[var(--ocp-ink)]`/`text-[var(--ocp-cyan)]`。
- 标题 `hero-gradient-text` **无需改动**：该类（index.css L296-311）用的是 `var(--ocp-ink)` 与 `var(--ocp-cyan)`，令牌在暗色下已反相，渐变自动变为「白 → 亮青绿 → 白」的扫光。

- [ ] **Step 3: flow 五步卡片玻璃化**

`.flow-card` 卡片 `bg-white` → `glass-card`；序号块 `bg-[var(--ocp-ink)] text-[var(--ocp-paper)]`（令牌反相后即亮底黑字，符合暗色高亮）；正文 `text-black/62` → `text-[var(--text-muted)]`；`section-kicker` 保留（用 vermilion，暗底上仍可读，若偏暗改用 `var(--ocp-cyan)`，实现者按对比度判断）。

- [ ] **Step 4: live / glance / why / open / onboarding / paths 板块换肤**

- 各 `<section>` 的 `bg-white` / `bg-[var(--ocp-paper)]` / `border-black/10` → 暗色：去掉 `bg-white`，用 `bg-transparent` 叠 `site-band-dark` 或局部 `ambient-field`；边框 `border-white/10`。
- 标题 `text-...` 保持（继承 `--ocp-ink` 已反相为白）；正文 `text-black/65` → `text-[var(--text-muted)]`。
- `why` 的 `protocol-chip-*`：暗底下需要暗色覆盖——在 index.css 为每个 `protocol-chip-*` 增加 `[data-theme='dark']` 版本（半透明色底 + 亮色文字）。**本步若发现 chip 在暗底不可读，回到 Task 3 追加暗色覆盖，不要在 JSX 写死颜色。**
- `paths` 的 `builder-card`：`bg-white` → `glass-card`，hover 暗色描边。
- 数据子组件容器（`live` 的 LiveActivitySection、`glance` 的三张 OcpDiagrams、`onboarding` 的 OnboardingScenePanel）：用 `glass-card` 外层包裹保证暗底可读，**不改组件内部**（深做留阶段三）。

- [ ] **Step 5: 类型检查 + 构建**

Run: `cd apps/ocp-site-web && bun run typecheck && bun run build`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/ocp-site-web/src/pages/HomePage.tsx apps/ocp-site-web/src/index.css
git commit -m "feat(site): immersive dark redesign of home page sections"
```

---

## Task 6: 集成验证（人工核对清单）

**Files:** 无（验证任务）

设计意图：视觉与主题生命周期无法用现有 bun 单测完全覆盖，用真实运行核对。这是验收门槛，禁止跳过。

- [ ] **Step 1: 全量检查**

Run: `cd apps/ocp-site-web && bun run typecheck && bun run build && bun test`
Expected: 三者全 PASS（含 Task 1 的 theme.test.ts）。

- [ ] **Step 2: 启动 dev 并按清单核对**

Run: `cd apps/ocp-site-web && bun run dev`（或 `bunx vite`），浏览器打开。逐项确认：

1. 首页 `/` 为暗色沉浸：hero 全屏氛围背景 + 白字 + 白底「Get Started」按钮；8 个 section 均暗色、文字可读。
2. 右侧 section rail、rAF 视差、reveal 滚入动画正常工作（与浅色时行为一致）。
3. 顶栏/页脚在首页为暗色。
4. 从首页点进 `/docs`、`/updates`：顶栏/页脚与页面**恢复浅色**，无暗色残留、无可见闪烁。
5. 再返回首页：正确回到暗色。
6. `/products`、`/products/ocp-catalog`、`/roadmap` 当前**仍为浅色**（阶段二再做）——确认它们未被本阶段破坏、顶栏为浅色。
7. EN ↔ 中文切换：首页双语下文案正确、暗色排版都成立。
8. 移动端（缩窄）：移动菜单暗色正确；汉堡按钮可见。
9. 浏览器开 `prefers-reduced-motion`：氛围/视差/reveal 动画静止，页面不破。
10. DevTools 无新增 console 报错/警告。

- [ ] **Step 3: 记录核对结果**

把上面 10 项的实际结果写入提交信息或 PR 描述。任一项不通过 → 回到对应 Task 修复根因，禁止用兜底掩盖。

- [ ] **Step 4: 提交（若 Step 2 有微调）**

```bash
git add -A
git commit -m "chore(site): stage-one dark theme integration verification"
```

---

## 阶段一完成判定

- `typecheck` / `build` / `bun test` 全绿。
- 人工核对 10 项全过。
- 浅色文档/新闻页零回归。
- 无兜底代码、无吞错、无新旧双实现、无写死颜色绕过令牌。

## 不在阶段一（后续 spec）

- 阶段二：Products / Products-OCP-Catalog / Roadmap 沉浸重做。
- 阶段三：LiveActivitySection / OcpDiagrams / ProtocolRelayCanvas / DirectoryExplorer 等数据/图表组件的深度沉浸重设计。
