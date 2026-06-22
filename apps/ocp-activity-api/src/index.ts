import { cors } from '@elysiajs/cors';
import { requireApiKey } from '@ocp-catalog/auth-core';
import { loadConfig } from '@ocp-catalog/config';
import { createActivityDb } from '@ocp-catalog/activity-db';
import { ActivityEventService } from '@ocp-catalog/ocp-activity-core';
import { AppError } from '@ocp-catalog/shared';
import { Elysia } from 'elysia';
import { ZodError } from 'zod';

const config = loadConfig();
const db = createActivityDb(config.DATABASE_URL);
const activity = new ActivityEventService(db);

const app = new Elysia()
  .use(cors())
  .onError(({ error, set }) => {
    if (error instanceof AppError) {
      set.status = error.status;
      return { error: { code: error.code, message: error.message, details: error.details } };
    }

    if (error instanceof ZodError) {
      set.status = 400;
      return { error: { code: 'validation_error', message: 'Invalid request payload', details: error.issues } };
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
    service: 'ocp-activity-api',
    protocol: 'ocp.activity.v1',
  }))
  .post('/ocp/audit/events', async ({ body, headers }) => {
    assertIngestAuth(headers);
    return activity.ingest(body);
  })
  .post('/ocp/audit/events/batch', async ({ body, headers }) => {
    assertIngestAuth(headers);
    return activity.ingestBatch(body);
  })
  .get('/api/activity/recent', async ({ query }) => ({
    events: await activity.listRecentPublicEvents(numberQuery(query.limit, 50)),
  }))
  .get('/api/activity/rollups', async ({ query }) => activity.getRollups(numberQuery(query.hours, 24)))
  .listen(config.OCP_ACTIVITY_API_PORT);

console.log(`OCP Activity API listening on http://localhost:${app.server?.port}`);

function assertIngestAuth(headers: Record<string, string | undefined>) {
  requireApiKey(
    firstHeader(headers['x-api-key']) ?? firstHeader(headers['authorization'])?.replace(/^Bearer\s+/i, ''),
    config.API_KEY_DEV,
    config.API_KEYS,
  );
}

function firstHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function numberQuery(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
