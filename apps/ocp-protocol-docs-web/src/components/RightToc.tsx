import type { TocHeading } from './Layout';
import { docsUiText, useDocsLocale } from '../content/i18n';

type RightTocProps = {
  headings: TocHeading[];
};

export function RightToc({ headings }: RightTocProps) {
  const { text } = useDocsLocale();
  const hasHeadings = headings.length > 0;

  return (
    <div className="lg:fixed lg:top-24 w-56">
      <div className="border border-slate-200 rounded-lg p-4 bg-white shadow-sm">
        <h4 className="text-sm tracking-wide font-semibold text-slate-800 uppercase mb-4 border-b border-slate-100 pb-2">
          {text(docsUiText.onThisPage)}
        </h4>

        {hasHeadings ? (
          <ul className="space-y-2 text-sm text-slate-600">
            {headings.map((heading) => (
              <li
                key={heading.id}
                className={heading.level > 2 ? 'pl-3 border-l border-slate-200' : ''}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    document.getElementById(heading.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                  className="block hover:text-indigo-600 transition-colors text-left"
                >
                  {heading.text}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">{text(docsUiText.noHeadings)}</p>
        )}
      </div>
    </div>
  );
}
