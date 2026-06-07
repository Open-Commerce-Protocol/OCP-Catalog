import { cors } from '@elysiajs/cors';
import { Elysia } from 'elysia';
import type { CommerceCatalogRuntimeContext } from '../runtime/context';
import { handleHttpError } from './errors';
import { logRequest, statusCode } from './request-context';
import { catalogAdminApiRoutes } from './routes/admin';
import { protocolRoutes } from './routes/protocol';
import { staticAdminRoutes } from './routes/static-admin';

export function createCommerceCatalogApp(runtime: CommerceCatalogRuntimeContext) {
  return new Elysia()
    .use(cors())
    .derive(({ request }) => ({
      requestStartedAt: performance.now(),
      requestPathname: new URL(request.url).pathname,
    }))
    .onAfterHandle(({ request, requestStartedAt, requestPathname, response, set }) => {
      logRequest({
        request,
        pathname: requestPathname,
        status: statusCode(response, set.status),
        durationMs: performance.now() - requestStartedAt,
      });
    })
    .onError(({ error, request, requestStartedAt, requestPathname, set }) => handleHttpError({
      error,
      request,
      requestStartedAt,
      requestPathname,
      set,
    }))
    .get('/health', () => ({
      ok: true,
      service: 'commerce-catalog-api',
      protocol: 'ocp.catalog.handshake.v1',
    }))
    .use(protocolRoutes(runtime))
    .use(catalogAdminApiRoutes(runtime))
    .use(staticAdminRoutes(runtime));
}
