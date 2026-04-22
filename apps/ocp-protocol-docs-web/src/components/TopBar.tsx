import { useMemo, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Book } from 'lucide-react';
import { navigation } from '../content/navigation';
import { docsUiText, resolveLocalizedText, useDocsLocale } from '../content/i18n';

export function TopBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState('');
  const { locale, localizePath, setLocale, text } = useDocsLocale();

  const currentPageLabel = useMemo(() => {
    const matched = navigation
      .flatMap((group) => group.links.map((link) => ({ group, link })))
      .find(({ link }) => link.href === location.pathname);

    if (!matched) {
      return location.pathname.replace(/^\//, '') || text({ en: 'overview', zh: '总览' });
    }

    return `${resolveLocalizedText(matched.group.title, locale)} / ${resolveLocalizedText(matched.link.title, locale)}`;
  }, [locale, location.pathname, text]);

  const searchResults = useMemo(() => {
    const keyword = query.trim().toLowerCase();

    if (!keyword) {
      return [];
    }

    return navigation
      .flatMap((group) => group.links)
      .filter((link) =>
        `${resolveLocalizedText(link.title, locale)} ${link.href}`.toLowerCase().includes(keyword),
      )
      .map((link) => ({
        href: link.href,
        title: resolveLocalizedText(link.title, locale),
      }))
      .slice(0, 8);
  }, [locale, query]);

  function handleNavigate(target: string) {
    navigate(localizePath(target));
    setQuery('');
  }

  return (
    <header className="h-14 bg-slate-900 text-slate-100 flex items-center justify-between px-4 sm:px-6 lg:px-8 border-b border-slate-800 sticky top-0 z-50">
      <div className="flex items-center gap-3">
        <Book className="w-5 h-5 text-indigo-400" />
        <NavLink
          to={localizePath('/')}
          className="font-semibold text-base tracking-wide hover:text-indigo-300 transition-colors"
        >
          {text(docsUiText.brand)}
        </NavLink>
        <span className="px-2 py-0.5 bg-slate-800 text-slate-300 rounded text-xs font-medium ml-2">
          {text(docsUiText.version)}
        </span>
      </div>
      
      <div className="flex items-center gap-4 text-sm font-medium">
        <div className="relative mr-4 hidden md:block">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={text(docsUiText.searchPlaceholder)}
            className="w-64 bg-slate-800 border border-slate-700 rounded-md py-1.5 pl-10 pr-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 placeholder-slate-400 sm:text-sm text-slate-200 transition-shadow"
          />

          {searchResults.length > 0 && (
            <div className="absolute top-[calc(100%+0.5rem)] left-0 w-full rounded-md border border-slate-700 bg-slate-900 shadow-xl overflow-hidden">
              {searchResults.map((result) => (
                <button
                  key={result.href}
                  type="button"
                  onClick={() => handleNavigate(result.href)}
                  className="w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800 transition-colors"
                >
                  <div>{result.title}</div>
                  <div className="text-xs text-slate-400">{result.href}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center rounded-md border border-slate-700 bg-slate-800 p-0.5">
          <button
            type="button"
            onClick={() => setLocale('en')}
            className={`rounded px-2.5 py-1 text-xs transition-colors ${
              locale === 'en' ? 'bg-slate-100 text-slate-900' : 'text-slate-300 hover:text-white'
            }`}
          >
            {text(docsUiText.langEn)}
          </button>
          <button
            type="button"
            onClick={() => setLocale('zh')}
            className={`rounded px-2.5 py-1 text-xs transition-colors ${
              locale === 'zh' ? 'bg-slate-100 text-slate-900' : 'text-slate-300 hover:text-white'
            }`}
          >
            {text(docsUiText.langZh)}
          </button>
        </div>

        <div className="hidden lg:flex items-center gap-2 text-slate-300">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
          <span className="text-xs uppercase tracking-[0.18em]" title={text(docsUiText.currentPage)}>
            {currentPageLabel}
          </span>
        </div>
      </div>
    </header>
  );
}
