# OCP 首页 Collov 风格深度重构 · 阶段三 计划

> **For agentic workers:** 由 Commander 逐 Task 调度 Implementation subagent，Task 间审查。

**Goal:** 把首页其余板块（flow / live / glance / why / open / onboarding / paths）从「黑底描边盒子」重构成 Collov 风格——满幅图像背景、巨型标题、极致留白（一屏一概念）、monospace 技术标签、克制配色。hero 已完成验证，本计划复用同一设计语言。

**Architecture:** 建立一套可复用的「沉浸段落」CSS 组件类（`.immersive-section` / `.section-bg` / `.mono-kicker` / `.giant-heading`），各板块改用它；满幅背景用已生成的氛围大图（hero-ambient/network-substrate/discovery-field + 待生成 trust-boundary/closing-ambient）；砍掉多余描边盒子、放大字号与留白；保留全部 i18n 文案与 section id、rail、reveal 逻辑。

**Tech Stack:** React 19 + Tailwind 3.4 + Vite 8 + Bun。

> **约束（Commander 原则）：** 禁止兜底/吞错；浅色现值不改（首页恒暗，但共享类的浅色分支不破坏文档页）；不删 section id / 不改文案 / 不改数据组件逻辑；canvas/SVG 几何不动。视觉任务用 build 通过 + 人工核对验证。

---

## 已确立的 Collov 设计语言（hero 已验证）

1. **满幅图像背景**：关键段用 16:9 氛围大图铺满，文字浮其上，渐变压暗保证可读。
2. **巨型标题**：`clamp()` 响应式、`tracking-[-0.02em]`、第二行降透明度做层次。
3. **monospace 技术标签**：小字号大写 `tracking-[0.2em+]` 的 kicker / 角标。
4. **极致留白**：一屏一概念，大 padding（`py-28`+），少元素。
5. **克制配色**：白字为主，青绿只在 CTA/强调点；砍掉彩色 protocol-chip 的花哨。
6. **砍盒子**：用细线分隔（`border-t border-white/10`）替代到处描边卡片。

## 图像素材到位情况

- ✅ `hero-ambient.png`（hero，已用）
- ✅ `network-substrate.png`（网络 mesh，用于 glance「联邦发现网络」段背景）
- ✅ `discovery-field.png`（粒子涌现，用于 flow 或 why 段背景）
- ⬜ `trust-boundary.png`（待生成，用于 why/trust 段；未到位前该段用 `.ambient-field` CSS 兜替**视觉占位**——注意：这是视觉占位非逻辑兜底，到位后替换）
- ⬜ `closing-ambient.png`（待生成，用于 paths 收尾段背景）

> 实现策略：本计划先用**已到位的 3 张图 + CSS 氛围层**完成全部板块；待 ④⑤ 生成后，仅需替换两处 `backgroundImage` URL（计划末注明）。

---

## Task 1: 沉浸段落基础类（index.css）

**Files:** Modify `apps/ocp-site-web/src/index.css`（在 `@layer components` 内新增；不改浅色现值）

- [ ] **Step 1: 新增可复用类**

```css
  /* ---- Collov-style immersive sections ---- */
  .immersive-section {
    position: relative;
    overflow: hidden;
    isolation: isolate;
  }

  /* 满幅段落背景图层 */
  .section-bg {
    position: absolute;
    inset: 0;
    z-index: -2;
    background-size: cover;
    background-position: center;
    opacity: 0.5;
  }

  /* 段落背景之上的暗渐变，保证文字可读（默认从底部压暗） */
  .section-veil {
    position: absolute;
    inset: 0;
    z-index: -1;
    background: linear-gradient(180deg, rgba(2,2,3,0.92) 0%, rgba(2,2,3,0.55) 40%, rgba(2,2,3,0.7) 100%);
  }

  /* 左压暗变体（文字在左、图像辉光在右时用） */
  .section-veil-left {
    background: linear-gradient(90deg, rgba(2,2,3,0.95) 0%, rgba(2,2,3,0.8) 45%, rgba(2,2,3,0.4) 75%, rgba(2,2,3,0.1) 100%);
  }

  .mono-kicker {
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: rgba(244, 245, 242, 0.5);
  }

  .mono-kicker-cyan {
    color: color-mix(in srgb, var(--ocp-cyan) 80%, transparent);
  }

  .giant-heading {
    font-size: clamp(2rem, 5vw, 3.75rem);
    line-height: 1.02;
    letter-spacing: -0.02em;
    font-weight: 600;
  }
```

- [ ] **Step 2: 构建** `cd apps/ocp-site-web && bun run build` → PASS
- [ ] **Step 3: 提交** `git commit -m "feat(site): reusable Collov immersive-section CSS primitives"`

---

## Task 2: flow / glance / why 三段重构（含满幅图背景）

**Files:** Modify `apps/ocp-site-web/src/pages/HomePage.tsx`

- [ ] **Step 1: flow「一次请求如何完成」**
  - section 加 `immersive-section`，去掉现有挤压的 5 卡 grid 的描边玻璃盒子观感：保留五步内容，但改成**横向编号序列**（大号 mono 序号 `01–05` + 标题 + 短描述），用细分隔线而非 5 个 glass-card。
  - kicker 改 `mono-kicker`。标题区放大留白（`py-28`）。
  - 背景：可叠 `discovery-field.png`（`.section-bg` opacity 调低 ~0.35 + `.section-veil`）。
- [ ] **Step 2: glance「联邦发现网络 / at a glance」**
  - 加 `immersive-section` + `<div className="section-bg" style backgroundImage network-substrate.png />` + `.section-veil`。
  - kicker→`mono-kicker`；标题→`giant-heading`，放大留白。
  - 三张 OcpDiagrams 保留（数据组件不动逻辑），但去掉每张外层 `glass-card p-4` 改为更通透的细线容器或直接留白堆叠，减少「盒子感」。
- [ ] **Step 3: why「为什么需要它」**
  - 加 `immersive-section`；右侧把 `home-commerce-object-stack.png` 换成满幅/大图处理或保留但加暗处理。
  - **砍掉花哨的 `protocol-chip-*` 彩色 chip**：改成一行 mono 文字序列 `Handshake · Registration · Query · Resolve · Action Binding`（白/60，分隔点用青绿），更克制。
  - kicker→`mono-kicker`，标题→`giant-heading`。
- [ ] **Step 4: typecheck + build** → PASS
- [ ] **Step 5: 提交** `git commit -m "feat(site): Collov rebuild of flow/glance/why sections"`

---

## Task 3: live / open / onboarding / paths 四段重构

**Files:** Modify `apps/ocp-site-web/src/pages/HomePage.tsx`

- [ ] **Step 1: live 实时活动**
  - 去掉外层 `glass-card`，改 `immersive-section` + 细线分隔 + `mono-kicker` 标题引导（若 LiveActivitySection 无标题则加一个）。数据组件内部不动。
- [ ] **Step 2: open 开源段**
  - 去掉 section 上的 `glass-card`（整段不该是一个大盒子）；改 `immersive-section`。
  - 右侧三个 `Open/Free/Federated` 统计盒子：去掉描边盒，改 mono 大字 + 细线分隔的横向排列。
  - kicker（金色 Unlock）保留但改 `mono-kicker-cyan` 或维持金色 mono。
- [ ] **Step 3: onboarding**
  - 去掉外层 `glass-card`，改通透容器；`OnboardingScenePanel` 内部不动。加 `mono-kicker` 引导。
- [ ] **Step 4: paths「下一步」**
  - 加 `immersive-section` + `closing-ambient.png` 背景（未生成前先用 `.ambient-field` 占位）+ `.section-veil`。
  - builder 路径卡：减弱描边、增大留白，hover 用青绿细线而非整框高亮。
  - kicker→`mono-kicker`，标题→`giant-heading`。
- [ ] **Step 5: typecheck + build** → PASS
- [ ] **Step 6: 提交** `git commit -m "feat(site): Collov rebuild of live/open/onboarding/paths sections"`

---

## Task 4: Review + 集成验证

- [ ] **Step 1: Review Agent** 审查：浅色文档页零回归（共享类 `.section-kicker` 等若被改需确认 docs 不受影响）、无兜底、无写死绕过令牌、reveal/rail/section id 保留、数据组件逻辑未动。
- [ ] **Step 2:** `bun run typecheck && bun run build && bun test` 全绿。
- [ ] **Step 3: dev 人工核对**：首页整体是否「Collov 味」——满幅图背景、巨标题、留白、mono 标签、盒子减少；八段连贯滚动；rail/视差/reveal 正常；/docs /updates 仍浅色无闪烁；EN/中文、移动端正常；无 console 报错。

---

## ④⑤ 图像到位后的收尾（单独小步）

生成 `trust-boundary.png`、`closing-ambient.png` 后：
- why 段（若用了 trust-boundary）与 paths 段把占位的 `.ambient-field` 替换为对应 `.section-bg` + `backgroundImage`。
- 放入 `apps/ocp-site-web/public/images/`，提交。

## 完成判定
- build/test 全绿；人工核对「Collov 味」达标；文档页零回归；无兜底/写死。
