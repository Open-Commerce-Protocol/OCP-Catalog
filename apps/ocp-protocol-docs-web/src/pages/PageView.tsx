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

type MarkdownAstNode = {
  position?: {
    start?: {
      line?: number;
    };
  };
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

function createHeadingId(text: string, line?: number): string {
  const baseId = slugify(normalizeHeadingText(text));
  return line ? `${baseId}-${line}` : baseId;
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
  return markdown
    .split('\n')
    .flatMap((line, index) => {
      const match = line.match(/^(#{1,3})\s+(.+)$/);

      if (!match) {
        return [];
      }

      const level = match[1].length;
      const text = normalizeHeadingText(match[2]);

      return [{
        id: createHeadingId(text, index + 1),
        level,
        text,
      }];
    });
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function parsePipeTable(value: string): string[][] | null {
  const lines = value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 3 || !lines.every((line) => line.startsWith('|') && line.endsWith('|'))) {
    return null;
  }

  if (!isTableSeparator(lines[1])) {
    return null;
  }

  const rows = lines.filter((_, index) => index !== 1).map(splitTableRow);
  const columnCount = rows[0]?.length ?? 0;

  if (columnCount < 2 || rows.some((row) => row.length !== columnCount)) {
    return null;
  }

  return rows;
}

function renderTableCellContent(value: string): ReactNode {
  return value
    .split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part, index) => {
      if (part.startsWith('`') && part.endsWith('`')) {
        return <code key={index}>{part.slice(1, -1)}</code>;
      }

      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={index}>{part.slice(2, -2)}</strong>;
      }

      return part;
    });
}

function createHeadingComponents(
  navigate: ReturnType<typeof useNavigate>,
  localizePath: (path: string) => string,
): Components {
  function nextId(children: ReactNode, node?: MarkdownAstNode) {
    return createHeadingId(extractTextFromNode(children), node?.position?.start?.line);
  }

  return {
    h1: ({ children, node }) => <h1 id={nextId(children, node)} className="scroll-mt-24">{children}</h1>,
    h2: ({ children, node }) => <h2 id={nextId(children, node)} className="scroll-mt-24">{children}</h2>,
    h3: ({ children, node }) => <h3 id={nextId(children, node)} className="scroll-mt-24">{children}</h3>,
    p: ({ children }) => {
      const tableRows = parsePipeTable(extractTextFromNode(children));

      if (!tableRows) {
        return <p>{children}</p>;
      }

      const [headers, ...bodyRows] = tableRows;

      return (
        <div className="docs-table-shell not-prose">
          <table className="docs-table">
            <thead>
              <tr>
                {headers.map((header, index) => (
                  <th key={index}>{renderTableCellContent(header)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{renderTableCellContent(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    },
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
  const markdownComponents = createHeadingComponents(navigate, localizePath);

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
