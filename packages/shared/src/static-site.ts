import { existsSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

export type StaticSiteHandler = (pathname: string) => Promise<Response | null>;

export function hasStaticSite(siteRoot: string, indexFile = 'index.html'): boolean {
  return existsSync(resolve(siteRoot, indexFile));
}

export function createSpaStaticSiteHandler(siteRoot: string, indexFile = 'index.html'): StaticSiteHandler {
  const root = resolve(siteRoot);
  const rootIndex = resolve(root, indexFile);

  return async (pathname: string) => {
    if (!hasStaticSite(root, indexFile)) {
      return null;
    }

    const safePath = normalizeRequestPath(pathname, indexFile);
    const candidate = resolve(root, `.${safePath}`);

    let targetPath = rootIndex;
    const relativePath = relative(root, candidate);
    const insideRoot = relativePath !== '' && !relativePath.startsWith('..') && !isAbsolute(relativePath);

    if (insideRoot && existsSync(candidate) && statSync(candidate).isFile()) {
      targetPath = candidate;
    }

    return new Response(Bun.file(targetPath));
  };
}

function normalizeRequestPath(pathname: string, indexFile: string): string {
  if (!pathname || pathname === '/') {
    return `/${indexFile}`;
  }

  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}
