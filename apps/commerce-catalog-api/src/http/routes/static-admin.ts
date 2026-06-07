import { Elysia } from 'elysia';
import type { CommerceCatalogRuntimeContext } from '../../runtime/context';

export function staticAdminRoutes(context: CommerceCatalogRuntimeContext) {
  return new Elysia()
    .get('/', () => serveCatalogAdmin(context, '/'))
    .get('/admin', () => serveCatalogAdmin(context, '/'))
    .get('/admin/*', async ({ request }) => {
      const pathname = new URL(request.url).pathname;
      if (pathname.startsWith('/admin/assets/')) {
        return serveCatalogAdmin(context, pathname.slice('/admin'.length));
      }

      return serveCatalogAdmin(context, '/');
    })
    .get('/*', async ({ request }) => {
      const pathname = new URL(request.url).pathname;
      if (isReservedPath(pathname) || !isPublicStaticAssetPath(pathname)) {
        return new Response('Not Found', { status: 404 });
      }

      return serveCatalogAdmin(context, pathname);
    });
}

async function serveCatalogAdmin(context: CommerceCatalogRuntimeContext, pathname: string) {
  const response = await context.catalogAdminSite(pathname);
  return response ?? new Response('Not Found', { status: 404 });
}

function isReservedPath(pathname: string) {
  return (
    pathname === '/health'
    || pathname.startsWith('/api/catalog-admin/')
    || pathname.startsWith('/ocp/')
    || pathname === '/.well-known/ocp-catalog'
  );
}

function isPublicStaticAssetPath(pathname: string) {
  return (
    pathname.startsWith('/assets/')
    || pathname === '/favicon.ico'
    || pathname === '/favicon.svg'
    || pathname === '/robots.txt'
    || pathname === '/manifest.webmanifest'
  );
}
