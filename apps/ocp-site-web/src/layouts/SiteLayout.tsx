import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { BookOpen, LayoutGrid, Menu, Milestone, Newspaper, X } from 'lucide-react';
import { docsUiText, useDocsLocale } from '../content/i18n';
import { stripLocalePrefix } from '../content/routing';
import { OcpLogo } from '../components/site/OcpLogo';
import { useTheme } from '../theme/ThemeContext';

const navItems = [
  { label: { en: 'News', zh: '新闻' }, href: '/updates', icon: Newspaper },
  { label: { en: 'Docs', zh: '文档' }, href: '/docs', icon: BookOpen },
  { label: { en: 'Products', zh: '产品' }, href: '/products', icon: LayoutGrid },
  { label: { en: 'Roadmap', zh: '路线图' }, href: '/roadmap', icon: Milestone },
];

export function SiteLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const { locale, localizePath, setLocale, text } = useDocsLocale();
  const { theme } = useTheme();
  const dark = theme === 'dark';
  const tagline = locale === 'zh' ? '面向 Agent 的商业对象' : 'commerce objects for agents';

  function isSectionActive(pathname: string, href: string) {
    const route = stripLocalePrefix(pathname);
    return route === href || route.startsWith(`${href}/`);
  }

  return (
    <div className="min-h-screen bg-[var(--ocp-paper)] text-[var(--ocp-ink)]">
      <header
        className={`sticky top-0 z-50 ${
          dark
            ? 'border-b border-white/10 bg-[rgba(5,6,8,0.72)] backdrop-blur-xl'
            : 'border-b border-black/10 bg-[rgba(246,247,242,0.88)] backdrop-blur-xl'
        }`}
      >
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link to={localizePath('/')} className="group flex items-center gap-3">
            <span className={`grid h-10 w-10 place-items-center rounded-md ${dark ? 'border border-white/12 bg-black shadow-[0_8px_24px_rgba(0,0,0,0.6)]' : 'bg-[var(--ocp-ink)] shadow-[0_10px_24px_rgba(20,20,20,0.18)]'}`}>
              <OcpLogo className="h-7 w-7" title="Open Commerce Protocol" />
            </span>
            <span className="hidden leading-tight sm:block">
              <span className="block font-semibold">{text(docsUiText.brand)}</span>
              <span className="block text-xs text-black/55">{tagline}</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-2 md:flex">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.href}
                  to={localizePath(item.href)}
                  className={({ isActive }) =>
                    `inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                      isActive || isSectionActive(location.pathname, item.href)
                        ? dark
                          ? 'bg-[rgba(46,230,224,0.14)] text-[var(--ocp-cyan)]'
                          : 'bg-black text-[var(--ocp-paper)]'
                        : dark
                          ? 'text-white/70 hover:bg-white/[0.08] hover:text-white'
                          : 'text-black/66 hover:bg-black/[0.06] hover:text-black'
                    }`
                  }
                >
                  <Icon className="h-4 w-4" />
                  {text(item.label)}
                </NavLink>
              );
            })}
          </nav>

          <div className="hidden items-center gap-3 md:flex">
            <div className={`flex items-center rounded-md p-0.5 ${dark ? 'border border-white/10 bg-white/[0.06]' : 'border border-black/10 bg-white/70'}`}>
              <button
                type="button"
                onClick={() => setLocale('en')}
                className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
                  locale === 'en'
                    ? 'bg-[var(--ocp-ink)] text-[var(--ocp-paper)]'
                    : dark
                      ? 'text-white/60 hover:text-white'
                      : 'text-black/60 hover:text-black'
                }`}
              >
                EN
              </button>
              <button
                type="button"
                onClick={() => setLocale('zh')}
                className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
                  locale === 'zh'
                    ? 'bg-[var(--ocp-ink)] text-[var(--ocp-paper)]'
                    : dark
                      ? 'text-white/60 hover:text-white'
                      : 'text-black/60 hover:text-black'
                }`}
              >
                中文
              </button>
            </div>
            {dark && (
              <Link
                to={localizePath('/docs')}
                className="hidden rounded-md bg-white px-4 py-2 text-sm font-semibold text-[#050608] transition-transform hover:-translate-y-0.5 md:inline-flex"
              >
                {locale === 'zh' ? '开始使用' : 'Get Started'}
              </Link>
            )}
          </div>

          <button
            type="button"
            onClick={() => setMenuOpen((value) => !value)}
            className={`grid h-10 w-10 place-items-center rounded-md md:hidden ${dark ? 'border border-white/10 bg-white/[0.06]' : 'border border-black/10 bg-white/70'}`}
            aria-label="Toggle navigation"
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {menuOpen && (
          <div className={`border-t bg-[var(--ocp-paper)] px-4 py-4 md:hidden ${dark ? 'border-white/10' : 'border-black/10'}`}>
            <div className="flex flex-col gap-2">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.href}
                    to={localizePath(item.href)}
                    onClick={() => setMenuOpen(false)}
                    className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${dark ? 'text-white/76 hover:bg-white/[0.08]' : 'text-black/76 hover:bg-black/[0.06]'}`}
                  >
                    <Icon className="h-4 w-4" />
                    {text(item.label)}
                  </NavLink>
                );
              })}
              <div className="mt-2 flex items-center gap-2">
                <button type="button" onClick={() => setLocale('en')} className={`rounded-md border px-3 py-1.5 text-sm ${dark ? 'border-white/10 bg-white/[0.06]' : 'border-black/10'}`}>
                  EN
                </button>
                <button type="button" onClick={() => setLocale('zh')} className={`rounded-md border px-3 py-1.5 text-sm ${dark ? 'border-white/10 bg-white/[0.06]' : 'border-black/10'}`}>
                  中文
                </button>
              </div>
            </div>
          </div>
        )}
      </header>

      <Outlet />

      <footer
        className={`border-t px-4 py-10 ${
          dark
            ? 'border-white/10 bg-[var(--ocp-paper)] text-[var(--ocp-ink)]'
            : 'border-black/10 bg-[var(--ocp-ink)] text-[var(--ocp-paper)]'
        }`}
      >
        <div className="mx-auto flex max-w-7xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <OcpLogo className="h-8 w-8 shrink-0" title="Open Commerce Protocol" />
            <div>
              <div className="font-semibold">Open Commerce Protocol</div>
              <div className="text-sm text-white/58">
                {locale === 'zh' ? '开放商业中的发现、查询、解析与动作绑定。' : 'Discovery, query, resolve, and action binding for open commerce.'}
              </div>
            </div>
          </div>
          <div className="flex gap-3 text-sm text-white/66">
            <Link to={localizePath('/updates')} className="hover:text-white">{text(docsUiText.updates)}</Link>
            <Link to={localizePath('/docs')} className="hover:text-white">{text(docsUiText.docs)}</Link>
            <Link to={localizePath('/products')} className="hover:text-white">{text(docsUiText.products)}</Link>
            <Link to={localizePath('/roadmap')} className="hover:text-white">{text(docsUiText.roadmap)}</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
