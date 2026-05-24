import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { artifactRegistry } from '../apps/ocp-protocol-docs-web/src/content/artifacts';
import { coreArtifacts } from '../apps/ocp-protocol-docs-web/src/content/artifacts/core';
import { examplesArtifacts } from '../apps/ocp-protocol-docs-web/src/content/artifacts/examples';
import { handshakeArtifacts } from '../apps/ocp-protocol-docs-web/src/content/artifacts/handshake';
import { registrationArtifacts } from '../apps/ocp-protocol-docs-web/src/content/artifacts/registration';
import { navigation } from '../apps/ocp-protocol-docs-web/src/content/navigation';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contentRoot = path.join(repoRoot, 'apps/ocp-protocol-docs-web/src/content');

function fail(message: string): never {
  throw new Error(message);
}

function routeToContentPath(route: string, locale?: 'zh'): string {
  const trimmed = route.replace(/^\/+|\/+$/g, '');
  const segments = trimmed ? trimmed.split('/') : ['overview'];
  const section = segments.length === 1 ? 'docs' : segments[0];
  const slug = segments.length === 1 ? segments[0] : segments.slice(1).join('/');
  const prefix = locale ? path.join('locales', locale) : '';
  return path.join(contentRoot, prefix, section, `${slug}.md`);
}

function walkMarkdown(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return walkMarkdown(absolute);
    }
    return entry.isFile() && entry.name.endsWith('.md') ? [absolute] : [];
  });
}

function walkFiles(dir: string, extensions: Set<string>): string[] {
  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') {
      return [];
    }

    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return walkFiles(absolute, extensions);
    }

    return entry.isFile() && extensions.has(path.extname(entry.name)) ? [absolute] : [];
  });
}

function stripAnchor(link: string): string {
  return link.split('#')[0] ?? link;
}

const navRoutes = new Set<string>();
for (const group of navigation) {
  for (const link of group.links) {
    navRoutes.add(link.href);
  }
}

const errors: string[] = [];

const artifactRouteCounts = new Map<string, string[]>();
for (const [groupName, group] of [
  ['core', coreArtifacts],
  ['handshake', handshakeArtifacts],
  ['registration', registrationArtifacts],
  ['examples', examplesArtifacts],
] as const) {
  for (const route of Object.keys(group)) {
    artifactRouteCounts.set(route, [...(artifactRouteCounts.get(route) ?? []), groupName]);
  }
}

for (const [route, groups] of artifactRouteCounts) {
  if (groups.length > 1) {
    errors.push(`Duplicate artifact route ${route} in groups: ${groups.join(', ')}`);
  }
}

for (const route of navRoutes) {
  for (const locale of [undefined, 'zh'] as const) {
    const markdownPath = routeToContentPath(route, locale);
    if (!existsSync(markdownPath)) {
      errors.push(`Missing ${locale ? `${locale} ` : ''}markdown for route ${route}: ${path.relative(repoRoot, markdownPath)}`);
    }
  }
}

for (const [route, definition] of Object.entries(artifactRegistry)) {
  if (!navRoutes.has(route)) {
    errors.push(`Artifact route is not in navigation: ${route}`);
  }

  if (!existsSync(routeToContentPath(route))) {
    errors.push(`Artifact route has no markdown page: ${route}`);
  }

  for (const section of definition.schemaSections ?? []) {
    const schemaPath = path.join(repoRoot, section.sourcePath);
    if (!existsSync(schemaPath)) {
      errors.push(`Missing schema referenced by ${route}: ${section.sourcePath}`);
    }
  }

  for (const ref of definition.implementationRefs ?? []) {
    const refPath = path.join(repoRoot, ref.path);
    if (!existsSync(refPath)) {
      errors.push(`Missing implementation ref referenced by ${route}: ${ref.path}`);
    }
  }
}

for (const markdownPath of walkMarkdown(contentRoot)) {
  const relative = path.relative(contentRoot, markdownPath).replace(/\\/g, '/');
  const content = readFileSync(markdownPath, 'utf8');

  if (/^slug:\s*\/docs\//m.test(content)) {
    errors.push(`Obsolete /docs frontmatter slug in ${relative}`);
  }

  const isLocale = relative.startsWith('locales/');
  if (!isLocale && relative !== 'README.md') {
    const route = relative.startsWith('docs/')
      ? `/${relative.replace(/^docs\//, '').replace(/\.md$/, '')}`
      : `/${relative.replace(/\.md$/, '')}`;
    if (!navRoutes.has(route)) {
      errors.push(`Markdown page is not reachable from navigation: ${relative}`);
    }
  }
}

const obsoletePathPatterns = [
  /docs\/ocp_catalog_handshake_protocol_v1\.md/,
  /docs\/ocp_catalog_registration_protocol_v1\.md/,
  /docs\/ocp_catalog_system_design\.md/,
  /docs\/repo-architecture\.md/,
  /docs\/design_v2\.md/,
  /docs\/skills\/ocp-catalog-agent/,
  /docs\/superpowers/,
];

for (const textPath of walkFiles(repoRoot, new Set(['.md', '.ts', '.tsx', '.json']))) {
  const relative = path.relative(repoRoot, textPath).replace(/\\/g, '/');
  const content = readFileSync(textPath, 'utf8');

  for (const pattern of obsoletePathPatterns) {
    if (pattern.test(content)) {
      errors.push(`Obsolete docs path pattern ${pattern} found in ${relative}`);
    }
  }
}

for (const markdownPath of walkMarkdown(path.join(repoRoot, 'docs'))) {
  const relative = path.relative(repoRoot, markdownPath).replace(/\\/g, '/');
  const content = readFileSync(markdownPath, 'utf8');
  const links = content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g);

  for (const match of links) {
    const rawLink = match[1]?.trim();
    if (!rawLink || rawLink.startsWith('http://') || rawLink.startsWith('https://') || rawLink.startsWith('#') || rawLink.startsWith('mailto:')) {
      continue;
    }

    const target = stripAnchor(rawLink);
    if (!target) {
      continue;
    }

    const resolved = path.resolve(path.dirname(markdownPath), target);
    if (!existsSync(resolved)) {
      errors.push(`Broken docs markdown link in ${relative}: ${rawLink}`);
    }
  }
}

if (errors.length > 0) {
  fail(`Docs integrity check failed:\n${errors.map((error) => `- ${error}`).join('\n')}`);
}

console.log(`Docs integrity check passed: ${navRoutes.size} routes, ${Object.keys(artifactRegistry).length} artifact entries.`);
