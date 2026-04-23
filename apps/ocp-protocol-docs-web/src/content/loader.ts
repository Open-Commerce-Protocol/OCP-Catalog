const modules = import.meta.glob('./**/*.md', {
  query: '?raw',
  import: 'default',
});

const sectionAliases: Record<string, string> = {
  docs: 'docs',
  handshake: 'handshake',
  center: 'registration',
  registration: 'registration',
  example: 'examples',
  examples: 'examples',
  page: 'pages',
  pages: 'pages',
};

function normalizePath(path: string): string {
  const trimmed = path.replace(/^\/+|\/+$/g, '');

  if (!trimmed) {
    return './docs/overview.md';
  }

  const segments = trimmed.split('/');

  if (segments.length === 1) {
    return `./docs/${segments[0]}.md`;
  }

  const [rawSection, ...rest] = segments;
  const section = sectionAliases[rawSection] ?? rawSection;

  return `./${section}/${rest.join('/')}.md`;
}

function localizedCandidates(path: string, locale: 'en' | 'zh') {
  const fullPath = normalizePath(path);
  const localizedPath = fullPath.replace('./', `./locales/${locale}/`);

  return locale === 'en' ? [fullPath] : [localizedPath, fullPath];
}

export async function loadPageContent(path: string, locale: 'en' | 'zh' = 'en'): Promise<string> {
  const candidates = localizedCandidates(path, locale);

  for (const candidate of candidates) {
    if (modules[candidate]) {
      const loader = modules[candidate] as () => Promise<string>;
      return await loader();
    }
  }

  const fullPath = candidates[0];

  return `# Page Not Found

The documentation for \`${path}\` does not exist yet.

Add a markdown file at \`${fullPath.replace('./', 'src/content/')}\` to continue building this section.`;
}
