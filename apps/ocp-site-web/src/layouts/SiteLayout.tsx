import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { BookOpen, Menu, Network, Newspaper, X } from 'lucide-react';
import { docsUiText, useDocsLocale } from '../content/i18n';
import { stripLocalePrefix } from '../content/routing';
import { OcpLogo } from '../components/site/OcpLogo';

const navItems = [
  { label: { en: 'Docs', zh: '文档' }, href: '/docs', icon: BookOpen },
  { label: { en: 'Directory', zh: '目录' }, href: '/directory', icon: Network },
  { label: { en: 'Updates', zh: '最新动态' }, href: '/updates', icon: Newspaper },
];

export function SiteLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const { locale, localizePath, setLocale, text } = useDocsLocale();
  const tagline = locale === 'zh' ? '面向 Agent 的商业对象' : 'commerce objects for agents';

  function isSectionActive(pathname: string, href: string) {
    const route = stripLocalePrefix(pathname);
    return route === href || route.startsWith(`${href}/`);
  }

  return (
    <div className="min-h-screen bg-[var(--ocp-paper)] text-[var(--ocp-ink)]">
      <header className="sticky top-0 z-50 border-b border-black/10 bg-[rgba(246,247,242,0.88)] backdrop-blur-xl">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link to={localizePath('/')} className="group flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-md bg-[var(--ocp-ink)] shadow-[0_10px_24px_rgba(20,20,20,0.18)]">
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
                        ? 'bg-black text-[var(--ocp-paper)]'
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
            <div className="flex items-center rounded-md border border-black/10 bg-white/70 p-0.5">
              <button
                type="button"
                onClick={() => setLocale('en')}
                className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
                  locale === 'en' ? 'bg-[var(--ocp-ink)] text-[var(--ocp-paper)]' : 'text-black/60 hover:text-black'
                }`}
              >
                EN
              </button>
              <button
                type="button"
                onClick={() => setLocale('zh')}
                className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
                  locale === 'zh' ? 'bg-[var(--ocp-ink)] text-[var(--ocp-paper)]' : 'text-black/60 hover:text-black'
                }`}
              >
                中文
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setMenuOpen((value) => !value)}
            className="grid h-10 w-10 place-items-center rounded-md border border-black/10 bg-white/70 md:hidden"
            aria-label="Toggle navigation"
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {menuOpen && (
          <div className="border-t border-black/10 bg-[var(--ocp-paper)] px-4 py-4 md:hidden">
            <div className="flex flex-col gap-2">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.href}
                    to={localizePath(item.href)}
                    onClick={() => setMenuOpen(false)}
                    className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-black/76 hover:bg-black/[0.06]"
                  >
                    <Icon className="h-4 w-4" />
                    {text(item.label)}
                  </NavLink>
                );
              })}
              <div className="mt-2 flex items-center gap-2">
                <button type="button" onClick={() => setLocale('en')} className="rounded-md border border-black/10 px-3 py-1.5 text-sm">
                  EN
                </button>
                <button type="button" onClick={() => setLocale('zh')} className="rounded-md border border-black/10 px-3 py-1.5 text-sm">
                  中文
                </button>
              </div>
            </div>
          </div>
        )}
      </header>

      <Outlet />

      <footer className="border-t border-black/10 bg-[var(--ocp-ink)] px-4 py-10 text-[var(--ocp-paper)]">
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
            <Link to={localizePath('/docs')} className="hover:text-white">{text(docsUiText.docs)}</Link>
            <Link to={localizePath('/directory')} className="hover:text-white">{text(docsUiText.directory)}</Link>
            <Link to={localizePath('/updates')} className="hover:text-white">{text(docsUiText.updates)}</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
