import { Children, isValidElement, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';
import { useDocsLocale } from '../content/i18n';
import { loadPageContent } from '../content/loader';
import { loadPageArtifacts, type LoadedPageArtifacts } from '../content/page-artifacts';
import type { TocHeading } from '../components/Layout';
import { PageArtifacts } from '../components/PageArtifacts';
import { scrollToElementById } from '../lib/scroll';

type LayoutContext = {
  setHeadings: (headings: TocHeading[]) => void;
};

function slugify(value: string): string {
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .replace(/\s+/g, '-');

  return normalized || 'section';
}

function normalizeHeadingText(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<\/?[^>]+>/g, '')
    .replace(/[*_~]/g, '')
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1')
    .trim();
}

function getHeadingId(text: string, counts: Map<string, number>): string {
  const normalizedText = normalizeHeadingText(text);
  const baseId = slugify(normalizedText);
  const seen = counts.get(baseId) ?? 0;
  counts.set(baseId, seen + 1);

  return seen === 0 ? baseId : `${baseId}-${seen + 1}`;
}

function extractTextFromNode(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') {
    return '';
  }

  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map((child) => extractTextFromNode(child)).join('');
  }

  if (isValidElement<{ children?: ReactNode }>(node)) {
    return extractTextFromNode(node.props.children);
  }

  return Children.toArray(node).map((child) => extractTextFromNode(child)).join('');
}

function extractHeadings(markdown: string): TocHeading[] {
  const counts = new Map<string, number>();

  return markdown
    .split('\n')
    .map((line) => line.match(/^(#{1,3})\s+(.+)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => {
      const level = match[1].length;
      const text = normalizeHeadingText(match[2]);

      return {
        id: getHeadingId(text, counts),
        level,
        text,
      };
    });
}

function createHeadingComponents(
  navigate: ReturnType<typeof useNavigate>,
  localizePath: (path: string) => string,
): Components {
  const counts = new Map<string, number>();

  function nextId(children: ReactNode) {
    return getHeadingId(extractTextFromNode(children), counts);
  }

  return {
    h1: ({ children }) => <h1 id={nextId(children)} className="scroll-mt-24">{children}</h1>,
    h2: ({ children }) => <h2 id={nextId(children)} className="scroll-mt-24">{children}</h2>,
    h3: ({ children }) => <h3 id={nextId(children)} className="scroll-mt-24">{children}</h3>,
    a: ({ href, children }) => {
      if (!href) {
        return <span>{children}</span>;
      }

      if (href.startsWith('#')) {
        const targetId = href.slice(1);
        return (
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              scrollToElementById(targetId);
            }}
            className="text-indigo-600 hover:text-indigo-500 underline underline-offset-2"
          >
            {children}
          </button>
        );
      }

      const isExternal = /^[a-z]+:/i.test(href) || href.startsWith('//');
      if (isExternal) {
        return (
          <a href={href} className="text-indigo-600 hover:text-indigo-500">
            {children}
          </a>
        );
      }

      const normalizedPath = href.startsWith('/') ? href : `/${href.replace(/^\/+/, '')}`;
      const target = localizePath(normalizedPath);
      return (
        <a
          href={target}
          onClick={(event) => {
            event.preventDefault();
            navigate(target);
          }}
          className="text-indigo-600 hover:text-indigo-500"
        >
          {children}
        </a>
      );
    },
    pre: ({ children }) => (
      <div className="docs-code-shell not-prose">
        <pre className="docs-code-block">
          {children}
        </pre>
      </div>
    ),
  };
}

export function PageView({ section, slug }: { section?: string; slug?: string }) {
  const params = useParams();
  const navigate = useNavigate();
  const { setHeadings } = useOutletContext<LayoutContext>();
  const { locale, text, localizePath } = useDocsLocale();
  const [content, setContent] = useState<string>('# Loading...');
  const [artifacts, setArtifacts] = useState<LoadedPageArtifacts>({
    schemaSections: [],
    schemaPackages: [],
    implementationRefs: [],
    endpointExamples: [],
  });
  const headings = useMemo(() => extractHeadings(content), [content]);
  const markdownComponents = useMemo(
    () => createHeadingComponents(navigate, localizePath),
    [content, localizePath, navigate],
  );

  const resolvedSection = params.section ?? section ?? 'docs';
  const pageSlug = params.slug ?? slug ?? 'overview';
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

  useEffect(() => {
    // With HashRouter, the URL hash is used for routing (e.g. `#/overview`),
    // so we can't use it for page anchors. We rely entirely on the manual
    // `scrollIntoView` calls in RightToc for in-page navigation.
  }, [artifacts, content]);

  return (
    <>
      <article className="docs-prose prose prose-slate max-w-none prose-headings:font-bold prose-headings:tracking-tight prose-a:text-indigo-600 hover:prose-a:text-indigo-500">
        <Markdown components={markdownComponents}>{content}</Markdown>
      </article>
      <PageArtifacts artifacts={artifacts} />
    </>
  );
}
