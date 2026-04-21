import { cors } from '@elysiajs/cors';
import { loadConfig } from '@ocp-catalog/config';
import { Elysia } from 'elysia';
import { createSpaStaticSiteHandler } from '@ocp-catalog/shared';
import { ZodError } from 'zod';
import { UserDemoAgentService } from './agent-service';
import { AgentError } from './errors';

const config = loadConfig();
const agent = new UserDemoAgentService(config);
const userDemoSite = createSpaStaticSiteHandler(new URL('../public/user-demo', import.meta.url).pathname);

const app = new Elysia()
  .use(cors())
  .onError(({ error, set }) => {
    const appError = error instanceof AgentError ? error : null;
    if (appError) {
      set.status = appError.status;
      return { error: { code: appError.code, message: appError.message, details: appError.details } };
    }

    if (error instanceof ZodError) {
      set.status = 400;
      return { error: { code: 'validation_error', message: 'Invalid request body', details: error.issues } };
    }

    set.status = 500;
    return {
      error: {
        code: 'internal_error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  })
  .get('/health', () => ({
    ok: true,
    service: 'ocp-user-demo-api',
    model: config.USER_DEMO_AGENT_MODEL,
  }))
  .post('/agent/turn', async ({ body }) => agent.turn(body))
  .post('/api/user-demo/agent/turn', async ({ body }) => agent.turn(body))
  .post('/agent/confirm-registration', async ({ body }) => agent.confirmRegistration(body))
  .post('/api/user-demo/agent/confirm-registration', async ({ body }) => agent.confirmRegistration(body))
  .get('/', () => serveUserDemo('/'))
  .get('/*', async ({ request }) => {
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith('/api/user-demo/') || pathname.startsWith('/agent/') || pathname === '/health') {
      return new Response('Not Found', { status: 404 });
    }

    return serveUserDemo(pathname);
  })
  .listen(config.USER_DEMO_API_PORT);

console.log(`OCP User Demo API listening on http://localhost:${app.server?.port}`);
if (await userDemoSite('/')) {
  console.log(`OCP User Demo static site mounted from apps/ocp-user-demo-api/public/user-demo`);
}

async function serveUserDemo(pathname: string) {
  const response = await userDemoSite(pathname);
  return response ?? new Response('Not Found', { status: 404 });
}
