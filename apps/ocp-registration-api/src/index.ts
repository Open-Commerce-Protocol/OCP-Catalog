import { fileURLToPath } from 'node:url';
import { cors } from '@elysiajs/cors';
import { requireApiKey } from '@ocp-catalog/auth-core';
import { buildRegistrationDiscovery, buildRegistrationManifest, createRegistrationServices, startCatalogRefreshScheduler } from '@ocp-catalog/registration-core';
import { loadConfig } from '@ocp-catalog/config';
import { createDb, schema } from '@ocp-catalog/db';
import { AppError, createSpaStaticSiteHandler } from '@ocp-catalog/shared';
import { Elysia } from 'elysia';
import { ZodError } from 'zod';

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
const services = createRegistrationServices(db, config);
const refreshScheduler = startCatalogRefreshScheduler(services.catalogs, config);
const registrationAdminSite = createSpaStaticSiteHandler(fileURLToPath(new URL('../public/dist', import.meta.url)));

const app = new Elysia()
  .use(cors())
  .onError(({ error, set }) => {
    if (error instanceof AppError) {
      set.status = error.status;
      return { error: { code: error.code, message: error.message, details: error.details } };
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
    service: 'ocp-registration-api',
    protocol: 'ocp.catalog.registration.v1',
  }))
  .get('/api/registration-admin/overview', async ({ headers }) => {
    assertAdminAuth(headers);
    return getRegistrationAdminOverview();
  })
  .get('/api/registration-admin/catalogs', async ({ headers }) => {
    assertAdminAuth(headers);
    return getRegistrationAdminCatalogs();
  })
  .get('/api/registration-admin/catalogs/:catalogId/registrations', async ({ headers, params }) => {
    assertAdminAuth(headers);
    return getRegistrationAdminRegistrations(params.catalogId);
  })
  .get('/api/registration-admin/search-audits', async ({ headers }) => {
    assertAdminAuth(headers);
    return getRegistrationAdminSearchAudits();
  })
  .get('/.well-known/ocp-registration', () => buildRegistrationDiscovery(config))
  .get('/ocp/registration/manifest', () => buildRegistrationManifest(config))
  .post('/ocp/catalogs/register', async ({ body, headers }) => services.catalogs.register(body, {
    sourceIp: firstHeader(headers['x-forwarded-for']) ?? firstHeader(headers['x-real-ip']),
    userAgent: firstHeader(headers['user-agent']),
  }))
  .get('/ocp/catalogs/:catalogId', async ({ params }) => services.catalogs.getCatalog(params.catalogId))
  .get('/ocp/catalogs/:catalogId/manifest-snapshot', async ({ params }) => services.catalogs.getManifestSnapshot(params.catalogId))
  .get('/ocp/catalogs/:catalogId/health', async ({ params }) => ({
    registration_id: config.REGISTRATION_ID,
    catalog_id: params.catalogId,
    checks: await services.catalogs.getHealth(params.catalogId),
  }))
  .get('/ocp/catalogs/:catalogId/verification', async ({ params }) => ({
    registration_id: config.REGISTRATION_ID,
    catalog_id: params.catalogId,
    records: await services.catalogs.listVerificationRecords(params.catalogId),
  }))
  .post('/ocp/catalogs/:catalogId/verify', async ({ params, body }) => services.catalogs.verify(params.catalogId, body ?? {}))
  .post('/ocp/catalogs/:catalogId/refresh', async ({ params, headers }) => services.catalogs.refresh(params.catalogId, {
    catalogToken: firstHeader(headers['x-catalog-token']),
  }))
  .post('/ocp/catalogs/:catalogId/token/rotate', async ({ params, headers }) => services.catalogs.rotateToken(params.catalogId, {
    catalogToken: firstHeader(headers['x-catalog-token']),
  }))
  .post('/ocp/catalogs/search', async ({ body, headers }) => services.catalogs.search(body, {
    requesterKey: firstHeader(headers['x-api-key']),
  }))
  .post('/ocp/catalogs/resolve', async ({ body }) => services.catalogs.resolve(body))
  .get('/', () => serveRegistrationAdmin('/'))
  .get('/*', async ({ request }) => {
    const pathname = new URL(request.url).pathname;
    if (
      pathname === '/health'
      || pathname.startsWith('/api/registration-admin/')
      || pathname.startsWith('/ocp/')
      || pathname === '/.well-known/ocp-registration'
    ) {
      return new Response('Not Found', { status: 404 });
    }

    return serveRegistrationAdmin(pathname);
  })
  .listen(config.REGISTRATION_API_PORT);

console.log(`OCP Catalog Registration API listening on http://localhost:${app.server?.port}`);
if (refreshScheduler) {
  console.log(`OCP Catalog Registration refresh scheduler enabled every ${config.REGISTRATION_REFRESH_INTERVAL_SECONDS}s`);
}
if (await registrationAdminSite('/')) {
  console.log('OCP Catalog Registration Admin static site mounted from apps/ocp-registration-api/public/dist');
}

function assertAdminAuth(headers: Record<string, string | undefined>) {
  requireApiKey(
    firstHeader(headers['x-admin-key']) ?? firstHeader(headers['x-api-key']),
    config.API_KEY_DEV,
    config.API_KEYS,
  );
}

function firstHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function serveRegistrationAdmin(pathname: string) {
  const response = await registrationAdminSite(pathname);
  return response ?? new Response('Not Found', { status: 404 });
}

async function getRegistrationAdminOverview() {
  const [catalogs, indexEntries, verificationRecords, healthChecks, searchAudits] = await Promise.all([
    db.select().from(schema.registeredCatalogs),
    db.select().from(schema.catalogIndexEntries),
    db.select().from(schema.catalogVerificationRecords),
    db.select().from(schema.catalogHealthChecks),
    db.select().from(schema.catalogSearchAuditRecords),
  ]);

  const registrationCatalogs = catalogs.filter((row) => row.registrationId === config.REGISTRATION_ID);
  const registrationIndexEntries = indexEntries.filter((row) => row.registrationId === config.REGISTRATION_ID && row.entryStatus === 'active');
  const registrationVerificationRecords = verificationRecords.filter((row) => row.registrationId === config.REGISTRATION_ID);
  const registrationHealthChecks = healthChecks.filter((row) => row.registrationId === config.REGISTRATION_ID);
  const registrationSearchAudits = searchAudits
    .filter((row) => row.registrationId === config.REGISTRATION_ID)
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());

  const latestSearch = registrationSearchAudits[0] ?? null;

  return {
    registration_id: config.REGISTRATION_ID,
    registration_name: config.REGISTRATION_NAME,
    refresh_scheduler_enabled: config.REGISTRATION_REFRESH_SCHEDULER_ENABLED,
    refresh_interval_seconds: config.REGISTRATION_REFRESH_INTERVAL_SECONDS,
    metrics: {
      registered_catalog_count: registrationCatalogs.length,
      indexed_catalog_count: registrationIndexEntries.length,
      verified_catalog_count: registrationCatalogs.filter((row) => row.verificationStatus === 'verified' || row.verificationStatus === 'not_required').length,
      healthy_catalog_count: registrationCatalogs.filter((row) => row.healthStatus === 'healthy').length,
      challenge_required_count: registrationCatalogs.filter((row) => row.verificationStatus === 'challenge_required').length,
      verification_record_count: registrationVerificationRecords.length,
      health_check_count: registrationHealthChecks.length,
      search_audit_count: registrationSearchAudits.length,
    },
    latest_search_audit: latestSearch
      ? {
          id: latestSearch.id,
          created_at: latestSearch.createdAt.toISOString(),
          result_count: latestSearch.resultCount,
          request_payload: latestSearch.requestPayload,
        }
      : null,
  };
}

async function getRegistrationAdminCatalogs() {
  const [catalogs, healthChecks, verificationRecords, registrationRecords] = await Promise.all([
    db.select().from(schema.registeredCatalogs),
    db.select().from(schema.catalogHealthChecks),
    db.select().from(schema.catalogVerificationRecords),
    db.select().from(schema.catalogRegistrationRecords),
  ]);

  const latestHealthByCatalog = new Map<string, typeof schema.catalogHealthChecks.$inferSelect>();
  for (const row of healthChecks
    .filter((item) => item.registrationId === config.REGISTRATION_ID)
    .sort((left, right) => right.checkedAt.getTime() - left.checkedAt.getTime())) {
    if (!latestHealthByCatalog.has(row.catalogId)) latestHealthByCatalog.set(row.catalogId, row);
  }

  const latestVerificationByCatalog = new Map<string, typeof schema.catalogVerificationRecords.$inferSelect>();
  for (const row of verificationRecords
    .filter((item) => item.registrationId === config.REGISTRATION_ID)
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())) {
    if (!latestVerificationByCatalog.has(row.catalogId)) latestVerificationByCatalog.set(row.catalogId, row);
  }

  const registrationCounts = new Map<string, number>();
  for (const row of registrationRecords.filter((item) => item.registrationId === config.REGISTRATION_ID)) {
    registrationCounts.set(row.catalogId, (registrationCounts.get(row.catalogId) ?? 0) + 1);
  }

  return {
    registration_id: config.REGISTRATION_ID,
    catalogs: catalogs
      .filter((row) => row.registrationId === config.REGISTRATION_ID)
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
      .map((row) => {
        const latestHealth = latestHealthByCatalog.get(row.catalogId);
        const latestVerification = latestVerificationByCatalog.get(row.catalogId);
        return {
          catalog_id: row.catalogId,
          homepage: row.homepage,
          well_known_url: row.wellKnownUrl,
          claimed_domains: row.claimedDomains,
          verification_status: row.verificationStatus,
          health_status: row.healthStatus,
          trust_tier: row.trustTier,
          status: row.status,
          active_registration_version: row.activeRegistrationVersion,
          active_snapshot_id: row.activeSnapshotId,
          updated_at: row.updatedAt.toISOString(),
          created_at: row.createdAt.toISOString(),
          token_issued_at: row.tokenIssuedAt?.toISOString() ?? null,
          registration_count: registrationCounts.get(row.catalogId) ?? 0,
          latest_health_check: latestHealth
            ? {
                status: latestHealth.status,
                checked_at: latestHealth.checkedAt.toISOString(),
                checked_url: latestHealth.checkedUrl,
                latency_ms: latestHealth.latencyMs,
                error: latestHealth.error,
              }
            : null,
          latest_verification: latestVerification
            ? {
                status: latestVerification.status,
                challenge_type: latestVerification.challengeType,
                created_at: latestVerification.createdAt.toISOString(),
                verified_at: latestVerification.verifiedAt?.toISOString() ?? null,
                verified_domain: latestVerification.verifiedDomain,
              }
            : null,
        };
      }),
  };
}

async function getRegistrationAdminRegistrations(catalogId: string) {
  const rows = await db.select().from(schema.catalogRegistrationRecords);
  return {
    registration_id: config.REGISTRATION_ID,
    catalog_id: catalogId,
    registrations: rows
      .filter((row) => row.registrationId === config.REGISTRATION_ID && row.catalogId === catalogId)
      .sort((left, right) => right.registrationVersion - left.registrationVersion || right.createdAt.getTime() - left.createdAt.getTime())
      .map((row) => ({
        id: row.id,
        registration_version: row.registrationVersion,
        status: row.status,
        created_at: row.createdAt.toISOString(),
        source_ip: row.sourceIp,
        user_agent: row.userAgent,
        registration_payload: row.registrationPayload,
        result_payload: row.resultPayload,
      })),
  };
}

async function getRegistrationAdminSearchAudits() {
  const rows = await db.select().from(schema.catalogSearchAuditRecords);
  return {
    registration_id: config.REGISTRATION_ID,
    audits: rows
      .filter((row) => row.registrationId === config.REGISTRATION_ID)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, 40)
      .map((row) => ({
        id: row.id,
        created_at: row.createdAt.toISOString(),
        result_count: row.resultCount,
        requester_key_hash: row.requesterKeyHash,
        request_payload: row.requestPayload,
      })),
  };
}

