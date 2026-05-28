import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CircleAlert } from 'lucide-react';
import { breakingChangeLabel, getUpdateBySlug, updateCategoryLabels } from '../content/updates';
import { resolveLocalizedText, useDocsLocale } from '../content/i18n';

export function UpdateDetailPage() {
  const { slug } = useParams();
  const update = getUpdateBySlug(slug);
  const { locale, localizePath } = useDocsLocale();

  if (!update) {
    return (
      <main className="site-section">
        <div className="site-container">
          <h1 className="text-4xl font-semibold">{locale === 'zh' ? '动态不存在' : 'Update not found'}</h1>
          <Link to={localizePath('/updates')} className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-[var(--ocp-cyan)]">
            <ArrowLeft className="h-4 w-4" />
            {locale === 'zh' ? '返回最新动态' : 'Back to updates'}
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="site-band">
      <article className="site-section">
        <div className="site-container max-w-4xl">
          <Link to={localizePath('/updates')} className="inline-flex items-center gap-2 text-sm font-semibold text-black/64 hover:text-black">
            <ArrowLeft className="h-4 w-4" />
            {locale === 'zh' ? '最新动态' : 'Updates'}
          </Link>
          <div className="mt-8 flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-black/[0.06] px-2 py-1 text-xs font-semibold text-black/60">
              {resolveLocalizedText(updateCategoryLabels[update.category], locale)}
            </span>
            {update.version && <span className="rounded-md bg-[rgba(0,167,165,0.12)] px-2 py-1 text-xs font-semibold text-[var(--ocp-cyan)]">{update.version}</span>}
            {update.breaking && (
              <span className="inline-flex items-center gap-1 rounded-md bg-[rgba(217,84,54,0.12)] px-2 py-1 text-xs font-semibold text-[var(--ocp-vermilion)]">
                <CircleAlert className="h-3.5 w-3.5" />
                {resolveLocalizedText(breakingChangeLabel, locale)}
              </span>
            )}
          </div>
          <h1 className="mt-5 text-5xl font-semibold leading-tight">{resolveLocalizedText(update.title, locale)}</h1>
          <p className="mt-5 text-lg leading-8 text-black/65">{resolveLocalizedText(update.summary, locale)}</p>
          <div className="mt-4 text-sm font-semibold text-black/50">{update.publishedAt}</div>

          <div className="mt-10 space-y-6 border-t border-black/10 pt-8 text-lg leading-8 text-black/72">
            {update.body.map((paragraph) => (
              <p key={paragraph.en}>{resolveLocalizedText(paragraph, locale)}</p>
            ))}
          </div>

          <div className="mt-10 flex flex-wrap gap-2">
            {update.tags.map((tag) => (
              <span key={tag} className="rounded-md border border-black/10 bg-white px-2.5 py-1 text-xs font-semibold text-black/58">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </article>
    </main>
  );
}
