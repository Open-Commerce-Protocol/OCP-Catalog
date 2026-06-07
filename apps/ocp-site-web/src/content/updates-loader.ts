import type { DocsLocale } from './i18n';
import { stripFrontmatter } from './markdown-frontmatter';

// `import.meta.glob` is a Vite compile-time macro; it is replaced with the
// resolved module map at build time. Under the `bun test` runner (no Vite)
// it is `undefined`, so we guard to an empty map — matching Vite's behavior
// when the glob matches no files. The pure `resolveUpdateContent` below takes
// an injected map and is what the tests exercise.
const rawModules =
  typeof import.meta.glob === 'function'
    ? import.meta.glob('./updates/**/*.md', {
        query: '?raw',
        import: 'default',
      })
    : ({} as Record<string, unknown>);

/**
 * Pure resolver: given a map of module-path -> raw string, return the best
 * raw markdown for (slug, locale), or null if the slug has no english source.
 * Exported for testing; production passes pre-resolved strings via loadUpdateContent.
 */
export function resolveUpdateContent(
  slug: string,
  locale: DocsLocale,
  resolved: Record<string, string>,
): string | null {
  const en = `./updates/${slug}.md`;
  const localized = `./updates/locales/${locale}/${slug}.md`;
  const candidates = locale === 'en' ? [en] : [localized, en];

  for (const candidate of candidates) {
    if (candidate in resolved) return resolved[candidate];
  }
  return null;
}

/**
 * Load + strip frontmatter for a news article. Returns a fallback markdown
 * string if the slug has no content file.
 */
export async function loadUpdateContent(slug: string, locale: DocsLocale = 'en'): Promise<string> {
  const en = `./updates/${slug}.md`;
  const localized = `./updates/locales/${locale}/${slug}.md`;
  const candidates = locale === 'en' ? [en] : [localized, en];

  for (const candidate of candidates) {
    const loader = rawModules[candidate] as (() => Promise<string>) | undefined;
    if (loader) {
      return stripFrontmatter(await loader());
    }
  }

  return `# Not available\n\nThis news article has no content file yet (expected \`src/content/updates/${slug}.md\`).`;
}
