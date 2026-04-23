import { loadConfig } from '@ocp-catalog/config';
import { fileURLToPath } from 'node:url';
import { createSpaStaticSiteHandler } from '@ocp-catalog/shared';
import { Elysia } from 'elysia';

const config = loadConfig();
const docsSite = createSpaStaticSiteHandler(fileURLToPath(new URL('../dist', import.meta.url)));

const app = new Elysia()
  .get('/health', () => ({
    ok: true,
    service: 'ocp-protocol-docs-web',
  }))
  .get('/', () => serveDocs('/'))
  .get('/*', async ({ request }) => {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/health') {
      return new Response('Not Found', { status: 404 });
    }

    return serveDocs(pathname);
  })
  .listen(config.PROTOCOL_DOCS_PORT);

console.log(`OCP Protocol Docs host listening on http://localhost:${app.server?.port}`);
if (!await docsSite('/')) {
  console.log('OCP Protocol Docs host started without build output. Run `bun run --cwd apps/ocp-protocol-docs-web build` first.');
}

async function serveDocs(pathname: string) {
  const response = await docsSite(pathname);
  return response ?? new Response('Not Found', { status: 404 });
}
