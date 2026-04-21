import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useOutletContext, useParams } from 'react-router-dom';
import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';
import { useDocsLocale } from '../content/i18n';
import { loadPageContent } from '../content/loader';
import { loadPageArtifacts, type LoadedPageArtifacts } from '../content/page-artifacts';
import type { TocHeading } from '../components/Layout';
import { PageArtifacts } from '../components/PageArtifacts';

type LayoutContext = {
  setHeadings: (headings: TocHeading[]) => void;
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
}

function extractHeadings(markdown: string): TocHeading[] {
  const counts = new Map<string, number>();

  return markdown
    .split('\n')
    .map((line) => line.match(/^(#{1,3})\s+(.+)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => {
      const level = match[1].length;
      const text = match[2].trim();
      const baseId = slugify(text);
      const seen = counts.get(baseId) ?? 0;
      counts.set(baseId, seen + 1);

      return {
        id: seen === 0 ? baseId : `${baseId}-${seen + 1}`,
        level,
        text,
      };
    });
}

function createHeadingComponents(): Components {
  const counts = new Map<string, number>();

  function nextId(children: ReactNode) {
    const text = Array.isArray(children)
      ? children.join('')
      : typeof children === 'string'
        ? children
        : String(children ?? '');
    const baseId = slugify(text);
    const seen = counts.get(baseId) ?? 0;
    counts.set(baseId, seen + 1);

    return seen === 0 ? baseId : `${baseId}-${seen + 1}`;
  }

  return {
    h1: ({ children }) => <h1 id={nextId(children)}>{children}</h1>,
    h2: ({ children }) => <h2 id={nextId(children)}>{children}</h2>,
    h3: ({ children }) => <h3 id={nextId(children)}>{children}</h3>,
    pre: ({ children }) => (
      <div className="docs-code-shell not-prose">
        <pre className="docs-code-block">
          {children}
        </pre>
      </div>
    ),
  };
}

export function PageView({ section }: { section?: string }) {
  const params = useParams();
  const { setHeadings } = useOutletContext<LayoutContext>();
  const { locale, text } = useDocsLocale();
  const [content, setContent] = useState<string>('# Loading...');
  const [artifacts, setArtifacts] = useState<LoadedPageArtifacts>({
    schemaSections: [],
    schemaPackages: [],
    implementationRefs: [],
    endpointExamples: [],
  });
  const headings = useMemo(() => extractHeadings(content), [content]);
  const markdownComponents = useMemo(() => createHeadingComponents(), [content]);

  const resolvedSection = params.section ?? section;
  const pageSlug = params.slug ?? 'overview';
  const routePath = resolvedSection ? `/${resolvedSection}/${pageSlug}` : `/${pageSlug}`;

  useEffect(() => {
    let isCancelled = false;

    async function fetchContent() {
      setContent('# Loading...');
      setArtifacts({
        schemaSections: [],
        schemaPackages: [],
        implementationRefs: [],
        endpointExamples: [],
      });
      const [mdContent, pageArtifacts] = await Promise.all([
        loadPageContent(routePath, locale),
        loadPageArtifacts(routePath),
      ]);

      if (!isCancelled) {
        setContent(mdContent);
        setArtifacts(pageArtifacts);
      }
    }

    fetchContent();

    return () => {
      isCancelled = true;
    };
  }, [locale, routePath]);

  useEffect(() => {
    const artifactHeadings: TocHeading[] = [];

    if (artifacts.schemaSections.length > 0) {
      artifactHeadings.push({ id: 'schema-fragments', level: 2, text: text({ en: 'Schema Fragments', zh: 'Schema 片段' }) });
    }

    if (artifacts.schemaPackages.length > 0) {
      artifactHeadings.push({ id: 'schema-packages', level: 2, text: text({ en: 'Schema Packages', zh: '完整 Schema 包' }) });
    }

    if (artifacts.endpointExamples.length > 0) {
      artifactHeadings.push({
        id: 'api-endpoint-examples',
        level: 2,
        text: text({ en: 'API Endpoint Examples', zh: 'API 接口示例' }),
      });
    }

    if (artifacts.implementationRefs.length > 0) {
      artifactHeadings.push({
        id: 'implemented-in-this-repo',
        level: 2,
        text: text({ en: 'Implemented In This Repo', zh: '仓库中的实现位置' }),
      });
    }

    setHeadings([...headings, ...artifactHeadings]);

    return () => {
      setHeadings([]);
    };
  }, [artifacts, headings, setHeadings, text]);

  return (
    <>
      <article className="docs-prose prose prose-slate max-w-none prose-headings:font-bold prose-headings:tracking-tight prose-a:text-indigo-600 hover:prose-a:text-indigo-500">
        <Markdown components={markdownComponents}>{content}</Markdown>
      </article>
      <PageArtifacts artifacts={artifacts} />
    </>
  );
}
