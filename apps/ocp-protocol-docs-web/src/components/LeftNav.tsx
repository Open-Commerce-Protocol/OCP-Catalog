import { NavLink } from 'react-router-dom';
import { navigation } from '../content/navigation';
import { resolveLocalizedText, useDocsLocale } from '../content/i18n';

export function LeftNav() {
  const { locale, localizePath } = useDocsLocale();

  return (
    <nav className="space-y-8">
      {navigation.map((group, idx) => (
        <div key={idx} className="pb-2">
          <h4 className="font-semibold text-slate-800 text-sm tracking-wide uppercase mb-3 px-2 border-b-2 border-indigo-100 inline-block">
            {resolveLocalizedText(group.title, locale)}
          </h4>
          <ul className="space-y-1 pl-1">
            {group.links.map((link, j) => (
              <li key={j}>
                <NavLink
                  to={localizePath(link.href)}
                  className={({ isActive }) =>
                    `block px-3 py-1.5 rounded-md transition-all duration-200 text-sm font-medium
                    ${isActive
                      ? 'bg-indigo-50 text-indigo-700 shadow-sm border-l-2 border-indigo-500'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 border-l-2 border-transparent'
                    }`
                  }
                >
                  {resolveLocalizedText(link.title, locale)}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
