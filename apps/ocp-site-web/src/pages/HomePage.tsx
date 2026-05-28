import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Boxes, Braces, Network, RadioTower, ShieldCheck, Sparkles } from 'lucide-react';
import { ProtocolRelayCanvas } from '../components/site/ProtocolRelayCanvas';
import {
  CatalogArchitectureDiagram,
  OnboardingScenePanel,
  SearchResolveActionDiagram,
  TrustBoundaryDiagram,
} from '../components/site/OcpDiagrams';
import { resolveLocalizedText, useDocsLocale, type LocalizedText } from '../content/i18n';
import { updates } from '../content/updates';

const flowSteps = [
  { label: { en: 'Connect', zh: '接入' }, body: { en: 'Merchants expose products and services through an OCP connector.', zh: '商家通过 OCP 接入应用开放商品与服务。' } },
  { label: { en: 'Index', zh: '索引' }, body: { en: 'Catalogs make those objects searchable without owning fulfillment.', zh: 'Catalog 让对象可被查找，但不接管履约。' } },
  { label: { en: 'Discover', zh: '发现' }, body: { en: 'Agents find the right catalog for the user intent.', zh: 'Agent 根据用户意图找到合适的 Catalog。' } },
  { label: { en: 'Inspect', zh: '查看' }, body: { en: 'Resolve opens the selected option with the details needed to decide.', zh: 'Resolve 展开候选项，呈现用户决策所需信息。' } },
  { label: { en: 'Act', zh: '行动' }, body: { en: 'Checkout, booking, or quote requests continue only after confirmation.', zh: '结账、预订或报价等动作只在确认后继续。' } },
];

const builderPaths = [
  { icon: Boxes, title: { en: 'For catalog builders', zh: 'Catalog 构建者' }, href: '/docs/examples/minimal-catalog', body: { en: 'Learn how searchable commerce objects are published and resolved.', zh: '了解商业对象如何被发布、搜索和展开。' } },
  { icon: RadioTower, title: { en: 'For merchants', zh: '商家与服务方' }, href: '/docs/examples/minimal-provider', body: { en: 'Connect existing product, inventory, quote, or booking systems.', zh: '接入已有商品、库存、报价或预订系统。' } },
  { icon: Network, title: { en: 'For agent teams', zh: 'Agent 团队' }, href: '/docs/examples/user-agent-flow', body: { en: 'Discover catalogs, compare candidates, and keep action consent explicit.', zh: '发现 Catalog、比较候选，并保持动作确认清晰。' } },
  { icon: Braces, title: { en: 'For protocol readers', zh: '协议读者' }, href: '/docs/protocols/handshake-v1/catalog-manifest', body: { en: 'Read the contracts behind discovery, query, resolve, and action binding.', zh: '阅读发现、查询、解析和动作绑定背后的契约。' } },
];

const heroStats = [
  { value: '01', label: { en: 'Discover', zh: '发现' } },
  { value: '02', label: { en: 'Resolve', zh: '解析' } },
  { value: '03', label: { en: 'Confirm', zh: '确认' } },
];

const layers = [
  { name: 'Handshake', tone: 'cyan' },
  { name: 'Registration', tone: 'gold' },
  { name: 'Query', tone: 'green' },
  { name: 'Resolve', tone: 'vermilion' },
  { name: 'Action Binding', tone: 'ink' },
];

const layerToneClass: Record<string, string> = {
  cyan: 'protocol-chip-cyan',
  gold: 'protocol-chip-gold',
  green: 'protocol-chip-green',
  vermilion: 'protocol-chip-vermilion',
  ink: 'protocol-chip-ink',
};

const sectionIds = ['hero', 'flow', 'glance', 'why', 'onboarding', 'paths'] as const;
type SectionId = (typeof sectionIds)[number];

const sectionLabels: Record<SectionId, LocalizedText> = {
  hero: { en: 'Intro', zh: '简介' },
  flow: { en: 'How', zh: '流程' },
  glance: { en: 'At a glance', zh: '一眼看懂' },
  why: { en: 'Why', zh: '为什么' },
  onboarding: { en: 'Onboarding', zh: '接入' },
  paths: { en: 'Next', zh: '下一步' },
};

function label(text: LocalizedText, locale: 'en' | 'zh') {
  return resolveLocalizedText(text, locale);
}

export function HomePage() {
  const { locale, localizePath } = useDocsLocale();
  const latestUpdate = updates[0];
  const heroRef = useRef<HTMLElement | null>(null);
  const [activeSection, setActiveSection] = useState<SectionId>('hero');

  // Hero scroll-progress parallax via rAF + CSS custom property
  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;
    let rafId = 0;
    let ticking = false;

    const update = () => {
      ticking = false;
      const rect = hero.getBoundingClientRect();
      const total = rect.height || 1;
      const scrolled = Math.min(Math.max(-rect.top / total, 0), 1);
      hero.style.setProperty('--scroll-progress', scrolled.toFixed(4));
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      rafId = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      window.cancelAnimationFrame(rafId);
    };
  }, []);

  // Reveal-on-scroll using IntersectionObserver
  useEffect(() => {
    const items = Array.from(document.querySelectorAll<HTMLElement>('.reveal-on-scroll'));
    if (items.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.12 },
    );

    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, []);

  // Section-in-view tracking for the side indicator
  useEffect(() => {
    const sections = sectionIds
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the entry closest to viewport top among intersecting ones
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) {
          setActiveSection(visible[0].target.id as SectionId);
        }
      },
      { rootMargin: '-30% 0px -55% 0px', threshold: 0 },
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  const scrollToSection = (id: SectionId) => {
    const el = document.getElementById(id);
    if (!el) return;
    const header = 80;
    const top = el.getBoundingClientRect().top + window.scrollY - header;
    window.scrollTo({ top, behavior: 'smooth' });
  };

  return (
    <main className="home-story">
      <nav className="home-section-nav" aria-label="Sections">
        {sectionIds.map((id) => (
          <button
            key={id}
            type="button"
            className={activeSection === id ? 'is-active' : ''}
            onClick={() => scrollToSection(id)}
            aria-label={label(sectionLabels[id], locale)}
          >
            <span>{label(sectionLabels[id], locale)}</span>
          </button>
        ))}
      </nav>

      <div className="home-panel-track">
      <section id="hero" ref={heroRef} className="home-panel relative isolate overflow-hidden">
        <div
          className="hero-bg hero-parallax-slow absolute inset-0 bg-cover bg-center opacity-78"
          style={{ backgroundImage: 'url(/images/site/home-hero-protocol-relay.png)' }}
          aria-hidden="true"
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(246,247,242,0.98)_0%,rgba(246,247,242,0.90)_39%,rgba(246,247,242,0.46)_62%,rgba(246,247,242,0.12)_100%)]" aria-hidden="true" />
        <div className="hero-sweep absolute inset-0" aria-hidden="true" />
        <ProtocolRelayCanvas />
        <div className="hero-live-field" aria-hidden="true">
          <span className="hero-beacon hero-beacon-a" />
          <span className="hero-beacon hero-beacon-b" />
          <span className="hero-beacon hero-beacon-c" />
          <span className="hero-scanline hero-scanline-a" />
          <span className="hero-scanline hero-scanline-b" />
        </div>

        <div className="relative mx-auto grid min-h-[78vh] w-full max-w-7xl items-center px-4 py-16 sm:px-6 lg:min-h-[calc(100vh-80px)] lg:grid-cols-[0.86fr_1.14fr] lg:px-8">
          <div className="hero-copy hero-parallax-fade max-w-3xl pt-6">
            <div className="reveal-item mb-6 inline-flex items-center gap-2 rounded-md border border-black/10 bg-white/72 px-3 py-1.5 text-sm font-semibold text-black/72 shadow-sm backdrop-blur">
              <ShieldCheck className="h-4 w-4 text-[var(--ocp-green)]" />
              {locale === 'zh' ? '让 AI Agent 读懂开放商业' : 'Commerce that AI agents can understand'}
            </div>
            <h1 className="reveal-item hero-gradient-text max-w-4xl select-none text-5xl font-semibold leading-[1.02] cursor-default sm:text-6xl lg:text-7xl">
              Open Commerce Protocol
            </h1>
            <p className="reveal-item mt-6 max-w-2xl text-xl leading-8 text-black/70">
              {locale === 'zh'
                ? 'OCP Catalog 把商品、服务和可执行动作变成开放的协议对象。Agent 可以发现它们、比较它们，并在用户确认后继续到商家的真实交易入口。'
                : 'OCP Catalog turns products, services, and action entry points into open protocol objects. Agents can discover them, compare them, and continue to merchant-owned execution after user confirmation.'}
            </p>
            <div className="reveal-item mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to={localizePath('/docs')} className="inline-flex items-center justify-center gap-2 rounded-md bg-[var(--ocp-ink)] px-5 py-3 text-sm font-semibold text-[var(--ocp-paper)] shadow-lg shadow-black/15 transition-transform hover:-translate-y-0.5">
                {locale === 'zh' ? '了解 OCP 如何工作' : 'See how OCP works'}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link to={localizePath('/updates')} className="inline-flex items-center justify-center rounded-md border border-black/12 bg-white/70 px-5 py-3 text-sm font-semibold text-black transition-colors hover:bg-white">
                {locale === 'zh' ? '查看项目进展' : 'View project updates'}
              </Link>
            </div>
            <div className="reveal-item mt-10 grid max-w-xl grid-cols-3 gap-2">
              {heroStats.map((item) => (
                <div key={item.value} className="rounded-md border border-black/10 bg-white/60 p-3 shadow-sm backdrop-blur">
                  <div className="font-mono text-xs font-semibold text-[var(--ocp-vermilion)]">{item.value}</div>
                  <div className="mt-1 text-sm font-semibold text-black/74">{label(item.label, locale)}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="pointer-events-none hidden min-h-[32rem] items-end justify-end lg:flex">
            <div className="hero-orbit-card hero-parallax-fast reveal-item relative mb-10 w-80 overflow-hidden rounded-md border border-white/44 bg-white/58 p-5 shadow-2xl shadow-black/16 backdrop-blur-xl">
              <div className="flex items-center gap-2 text-sm font-semibold text-black/68">
                <Sparkles className="h-4 w-4 text-[var(--ocp-gold)]" />
                {locale === 'zh' ? '开放目录层' : 'Open catalog layer'}
              </div>
              <div className="mt-4 grid gap-2 text-sm text-black/64">
                <div className="hero-status-row flex items-center justify-between rounded bg-white/66 px-3 py-2"><span>{locale === 'zh' ? '发现入口' : 'Discovery'}</span><span className="font-semibold text-[var(--ocp-cyan)]">{locale === 'zh' ? '开放' : 'live'}</span></div>
                <div className="hero-status-row flex items-center justify-between rounded bg-white/66 px-3 py-2"><span>{locale === 'zh' ? '对象查询' : 'Object search'}</span><span className="font-semibold text-[var(--ocp-green)]">{locale === 'zh' ? '可用' : 'ready'}</span></div>
                <div className="hero-status-row flex items-center justify-between rounded bg-white/66 px-3 py-2"><span>{locale === 'zh' ? '动作确认' : 'Action consent'}</span><span className="font-semibold text-[var(--ocp-vermilion)]">{locale === 'zh' ? '必需' : 'required'}</span></div>
              </div>
            </div>
          </div>
        </div>
        <div className="hero-scroll-cue hidden lg:flex" aria-hidden="true">
          <span />
        </div>
      </section>

      <section id="flow" className="home-panel site-section">
        <div className="site-container">
          <div className="reveal-on-scroll section-kicker">{locale === 'zh' ? '一次请求如何完成' : 'How one request moves'}</div>
          <div className="mt-4 grid gap-3 lg:grid-cols-5">
            {flowSteps.map((step, index) => (
              <div
                key={step.label.en}
                className="flow-card reveal-on-scroll relative rounded-md border border-black/10 bg-white p-5 shadow-sm"
                style={{ '--reveal-delay': `${index * 90}ms` } as CSSProperties}
              >
                <div className="mb-5 flex h-9 w-9 items-center justify-center rounded-md bg-[var(--ocp-ink)] text-sm font-semibold text-[var(--ocp-paper)]">
                  {index + 1}
                </div>
                <h2 className="text-lg font-semibold">{label(step.label, locale)}</h2>
                <p className="mt-3 text-sm leading-6 text-black/62">{label(step.body, locale)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="glance" className="home-panel home-diagram-panel site-section border-y border-black/10 bg-white">
        <div className="site-container">
          <div className="reveal-on-scroll mb-8 max-w-3xl">
            <div className="section-kicker">{locale === 'zh' ? '一眼看懂 OCP Catalog' : 'OCP Catalog at a glance'}</div>
            <h2 className="mt-4 text-4xl font-semibold leading-tight">
              {locale === 'zh' ? '先理解它帮谁连接了什么，再决定是否深入文档。' : 'Understand who it connects and what stays under control before diving deeper.'}
            </h2>
          </div>
          <div className="home-diagram-stack space-y-5">
            <div className="reveal-on-scroll"><CatalogArchitectureDiagram locale={locale} /></div>
            <div className="reveal-on-scroll" style={{ '--reveal-delay': '120ms' } as CSSProperties}><SearchResolveActionDiagram locale={locale} /></div>
            <div className="reveal-on-scroll" style={{ '--reveal-delay': '240ms' } as CSSProperties}><TrustBoundaryDiagram locale={locale} /></div>
          </div>
        </div>
      </section>

      <section id="why" className="home-panel site-section border-y border-black/10 bg-white">
        <div className="site-container grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div className="reveal-on-scroll">
            <div className="section-kicker">{locale === 'zh' ? '为什么需要它' : 'Why this matters'}</div>
            <h2 className="mt-4 text-4xl font-semibold leading-tight">{locale === 'zh' ? '让 Agent 找得到、看得懂，也不会绕过商家的交易边界。' : 'Agents can find and understand commerce options without bypassing merchant boundaries.'}</h2>
            <p className="mt-5 text-lg leading-8 text-black/65">
              {locale === 'zh'
                ? 'OCP 不替代店铺、库存、报价或结账系统。它只把发现、查询、详情查看和动作确认的边界标准化。'
                : 'OCP does not replace stores, inventory, quotes, or checkout. It standardizes the boundary for discovery, search, detail lookup, and confirmed action.'}
            </p>
            <div className="mt-8 flex flex-wrap gap-2">
              {layers.map((layer) => (
                <span key={layer.name} className={`protocol-chip ${layerToneClass[layer.tone]}`}>{layer.name}</span>
              ))}
            </div>
          </div>
          <img
            src="/images/site/home-commerce-object-stack.png"
            alt=""
            className="reveal-on-scroll aspect-[4/3] w-full rounded-md border border-black/10 object-cover shadow-2xl shadow-black/12"
            style={{ '--reveal-delay': '120ms' } as CSSProperties}
          />
        </div>
      </section>

      <section id="onboarding" className="home-panel site-section">
        <div className="site-container reveal-on-scroll">
          <OnboardingScenePanel locale={locale} />
        </div>
      </section>

      <section id="paths" className="home-panel site-section">
        <div className="site-container">
          <div className="reveal-on-scroll flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="section-kicker">{locale === 'zh' ? '下一步阅读' : 'Where to go next'}</div>
              <h2 className="mt-4 max-w-3xl text-4xl font-semibold leading-tight">{locale === 'zh' ? '按你的身份选择入口。' : 'Choose the path that matches your role.'}</h2>
            </div>
            <Link to={localizePath('/docs')} className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--ocp-cyan)]">
              {locale === 'zh' ? '完整文档入口' : 'Full docs entry'}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {builderPaths.map((path, index) => {
              const Icon = path.icon;
              return (
                <Link
                  key={path.href}
                  to={localizePath(path.href)}
                  className="builder-card reveal-on-scroll group rounded-md border border-black/10 bg-white p-5 shadow-sm"
                  style={{ '--reveal-delay': `${index * 80}ms` } as CSSProperties}
                >
                  <Icon className="h-6 w-6 text-[var(--ocp-vermilion)]" />
                  <h3 className="mt-5 text-lg font-semibold">{label(path.title, locale)}</h3>
                  <p className="mt-3 text-sm leading-6 text-black/62">{label(path.body, locale)}</p>
                  <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-black/72 group-hover:text-black">
                    {locale === 'zh' ? '打开' : 'Open'} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {latestUpdate && (
        <section className="home-panel site-section border-t border-black/10 bg-[var(--ocp-ink)] text-[var(--ocp-paper)]">
          <div className="site-container reveal-on-scroll flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase text-[var(--ocp-gold)]">{locale === 'zh' ? '项目进展' : 'Project update'}</div>
              <h2 className="mt-3 max-w-3xl text-3xl font-semibold">{label(latestUpdate.title, locale)}</h2>
              <p className="mt-3 max-w-2xl text-white/62">{label(latestUpdate.summary, locale)}</p>
            </div>
            <Link to={localizePath(`/updates/${latestUpdate.slug}`)} className="inline-flex items-center justify-center gap-2 rounded-md bg-[var(--ocp-paper)] px-5 py-3 text-sm font-semibold text-[var(--ocp-ink)] transition-transform hover:-translate-y-0.5">
              {locale === 'zh' ? '查看详情' : 'Read more'}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      )}
      </div>
    </main>
  );
}
