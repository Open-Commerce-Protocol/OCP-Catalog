import type { AppConfig } from '@ocp-catalog/config';
import type { Db } from '@ocp-catalog/db';
import { schema } from '@ocp-catalog/db';
import { catalogManifestSchema, type CatalogManifest } from '@ocp-catalog/ocp-schema';
import {
  catalogRegistrationSchema,
  catalogResolveRequestSchema,
  catalogSearchRequestSchema,
  catalogVerificationRequestSchema,
  type CatalogRegistration,
  type CatalogRegistrationResult,
  type CatalogRefreshResult,
  type CatalogRouteHint,
  type CatalogSearchResult,
  type CatalogSearchResultItem,
  type CatalogTokenRotationResult,
  type CatalogVerificationResult,
} from '@ocp-catalog/center-schema';
import { AppError, newId, nowIso } from '@ocp-catalog/shared';
import { and, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { fetchCatalogProfile, isLocalhost, validateFetchedCatalog } from './catalog-fetcher';
import { verifyChallenge, type StoredChallenge } from './domain-verification';
import {
  asRecord,
  buildCatalogSearchProjection,
  objectContractSummaries,
  stringArray,
  stringValue,
  supportedQueryModes,
  supportedQueryLanguages,
  supportedQueryPacks,
  supportsResolve,
  contentLanguages,
} from './projection';
import { hashCatalogToken, issueCatalogToken, verifyCatalogToken } from './tokens';

export type RequestMeta = {
  sourceIp?: string | null;
  userAgent?: string | null;
  requesterKey?: string | null;
  catalogToken?: string | null;
};

export class CatalogRegistryService {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
  ) {}

  async register(input: unknown, meta: RequestMeta = {}): Promise<CatalogRegistrationResult> {
    const registration = catalogRegistrationSchema.parse(input);
    if (registration.center_id !== this.config.CENTER_ID) {
      throw new AppError('validation_error', `center_id must be ${this.config.CENTER_ID}`, 400);
    }

    const active = await this.findRegisteredCatalog(registration.catalog_id);
    if (active?.activeRegistrationVersion && registration.registration_version <= active.activeRegistrationVersion) {
      const result: CatalogRegistrationResult = {
        ocp_version: '1.0',
        kind: 'CatalogRegistrationResult',
        id: newId('catregres'),
        center_id: this.config.CENTER_ID,
        catalog_id: registration.catalog_id,
        status: 'stale_ignored',
        effective_registration_version: active.activeRegistrationVersion,
        manifest_fetch_status: 'not_attempted',
        verification_status: active.verificationStatus as 'verified' | 'challenge_required' | 'failed' | 'not_required',
        health_status: active.healthStatus as 'healthy' | 'unhealthy' | 'unknown',
        indexed: Boolean(active.activeSnapshotId),
        warnings: [`registration_version ${registration.registration_version} is not newer than active version ${active.activeRegistrationVersion}`],
        verification_challenges: [],
        message: 'Registration recorded, but active Catalog profile was not changed.',
      };
      await this.recordRegistration(registration, result, meta);
      return result;
    }

    const warnings: string[] = [];
    const { discovery, manifest } = await fetchCatalogProfile(registration.well_known_url);
    warnings.push(...validateFetchedCatalog(registration, discovery, manifest));

    const manifestUrl = discovery.manifest_url;
    const hostname = new URL(registration.well_known_url).hostname;
    const autoVerified = isLocalhost(hostname) || registration.claimed_domains.every((domain) => isLocalhost(domain));
    const verificationStatus = autoVerified ? 'verified' : 'challenge_required';
    const trustTier = autoVerified ? 'local_dev' : 'unverified';
    const health = await this.checkHealth(registration.catalog_id, manifest.endpoints.query.url);
    const indexed = autoVerified && health.status === 'healthy';
    const status = indexed ? 'accepted_indexed' : 'accepted_pending_verification';
    const issuedToken = indexed ? issueCatalogToken() : undefined;
    const issuedAt = issuedToken ? new Date() : null;

    const result: CatalogRegistrationResult = {
      ocp_version: '1.0',
      kind: 'CatalogRegistrationResult',
      id: newId('catregres'),
      center_id: this.config.CENTER_ID,
      catalog_id: registration.catalog_id,
      status,
      effective_registration_version: registration.registration_version,
      manifest_fetch_status: 'fetched',
      verification_status: verificationStatus,
      health_status: health.status,
      indexed,
      warnings,
      verification_challenges: autoVerified ? [] : await this.buildVerificationChallenges(registration),
      ...(issuedToken ? { catalog_access_token: issuedToken } : {}),
      ...(issuedAt ? { token_issued_at: issuedAt.toISOString() } : {}),
      message: indexed
        ? 'Catalog registration accepted, verified for local development, and indexed.'
        : 'Catalog registration accepted but pending domain verification.',
    };

    const registrationRecord = await this.recordRegistration(registration, result, meta);
    const manifestHash = hashJson(manifest);
    const snapshotId = newId('catsnap');
    await this.db.insert(schema.catalogManifestSnapshots).values({
      id: snapshotId,
      centerId: this.config.CENTER_ID,
      catalogId: registration.catalog_id,
      registrationId: registrationRecord.id,
      manifestUrl,
      discoveryPayload: discovery as unknown as Record<string, unknown>,
      manifestPayload: manifest as unknown as Record<string, unknown>,
      manifestHash,
      supportedObjectTypes: manifest.supported_object_types,
      queryCapabilities: manifest.query_capabilities,
      objectContractSummaries: objectContractSummaries(manifest),
    });

    const projection = buildCatalogSearchProjection(registration, manifest, verificationStatus, trustTier, health.status);
    await this.db
      .insert(schema.registeredCatalogs)
      .values({
        id: newId('regcat'),
        centerId: this.config.CENTER_ID,
        catalogId: registration.catalog_id,
        activeRegistrationId: registrationRecord.id,
        activeRegistrationVersion: registration.registration_version,
        activeSnapshotId: snapshotId,
        status,
        verificationStatus,
        healthStatus: health.status,
        trustTier,
        catalogAccessTokenHash: issuedToken ? hashCatalogToken(issuedToken) : null,
        tokenIssuedAt: issuedAt,
        homepage: registration.homepage,
        wellKnownUrl: registration.well_known_url,
        claimedDomains: registration.claimed_domains,
        operator: registration.operator as Record<string, unknown>,
      })
      .onConflictDoUpdate({
        target: [schema.registeredCatalogs.centerId, schema.registeredCatalogs.catalogId],
        set: {
          activeRegistrationId: registrationRecord.id,
          activeRegistrationVersion: registration.registration_version,
          activeSnapshotId: snapshotId,
          status,
          verificationStatus,
          healthStatus: health.status,
          trustTier,
          catalogAccessTokenHash: issuedToken ? hashCatalogToken(issuedToken) : active?.catalogAccessTokenHash ?? null,
          tokenIssuedAt: issuedAt ?? active?.tokenIssuedAt ?? null,
          homepage: registration.homepage,
          wellKnownUrl: registration.well_known_url,
          claimedDomains: registration.claimed_domains,
          operator: registration.operator as Record<string, unknown>,
          updatedAt: new Date(),
        },
      });

    if (indexed) {
      await this.upsertIndexEntry(registration, manifest, snapshotId, manifestUrl, projection, verificationStatus, trustTier, health.status);
    }

    return result;
  }

  async verify(catalogId: string, input: unknown = {}): Promise<CatalogVerificationResult> {
    const request = catalogVerificationRequestSchema.parse(input);
    const catalog = await this.getCatalog(catalogId);
    const challenges = await this.db
      .select()
      .from(schema.catalogVerificationRecords)
      .where(and(
        eq(schema.catalogVerificationRecords.centerId, this.config.CENTER_ID),
        eq(schema.catalogVerificationRecords.catalogId, catalogId),
        eq(schema.catalogVerificationRecords.status, 'pending'),
      ));

    const selected = request.challenge_id
      ? challenges.filter((challenge) => challenge.id === request.challenge_id)
      : challenges;

    if (selected.length === 0) {
      throw new AppError('not_found', `No pending verification challenge found for catalog ${catalogId}`, 404);
    }

    const verifiedDomains: string[] = [];
    const failedChallenges: string[] = [];

    for (const record of selected) {
      const challenge = asRecord(record.challengePayload) as StoredChallenge;
      const result = await verifyChallenge(challenge, catalogId, this.config.CENTER_ID);
      if (result.ok) {
        verifiedDomains.push(result.domain);
        await this.db
          .update(schema.catalogVerificationRecords)
          .set({
            status: 'verified',
            verifiedDomain: result.domain,
            verifiedAt: new Date(),
          })
          .where(eq(schema.catalogVerificationRecords.id, record.id));
      } else {
        failedChallenges.push(`${record.id}: ${result.reason}`);
      }
    }

    if (verifiedDomains.length === 0) {
      return {
        ocp_version: '1.0',
        kind: 'CatalogVerificationResult',
        id: newId('catverres'),
        center_id: this.config.CENTER_ID,
        catalog_id: catalogId,
        verification_status: 'failed',
        indexed: false,
        verified_domains: [],
        failed_challenges: failedChallenges,
        message: 'No verification challenge passed.',
      };
    }

    const token = catalog.catalogAccessTokenHash ? undefined : issueCatalogToken();
    const tokenIssuedAt = token ? new Date() : catalog.tokenIssuedAt;
    await this.db
      .update(schema.registeredCatalogs)
      .set({
        status: 'accepted_indexed',
        verificationStatus: 'verified',
        trustTier: 'verified_domain',
        ...(token ? { catalogAccessTokenHash: hashCatalogToken(token), tokenIssuedAt } : {}),
        updatedAt: new Date(),
      })
      .where(and(
        eq(schema.registeredCatalogs.centerId, this.config.CENTER_ID),
        eq(schema.registeredCatalogs.catalogId, catalogId),
      ));

    await this.indexActiveSnapshot(catalogId, 'verified', 'verified_domain');

    return {
      ocp_version: '1.0',
      kind: 'CatalogVerificationResult',
      id: newId('catverres'),
      center_id: this.config.CENTER_ID,
      catalog_id: catalogId,
      verification_status: 'verified',
      indexed: true,
      verified_domains: verifiedDomains,
      failed_challenges: failedChallenges,
      ...(token ? { catalog_access_token: token } : {}),
      message: token
        ? 'Catalog verified, indexed, and catalog-specific token issued.'
        : 'Catalog verified and indexed.',
    };
  }

  async refresh(catalogId: string, meta: RequestMeta = {}): Promise<CatalogRefreshResult> {
    const catalog = await this.requireCatalogToken(catalogId, meta.catalogToken);
    return this.refreshCatalogWithoutToken(catalogId, catalog);
  }

  async refreshDueCatalogs() {
    const rows = await this.db
      .select()
      .from(schema.registeredCatalogs)
      .where(and(
        eq(schema.registeredCatalogs.centerId, this.config.CENTER_ID),
        eq(schema.registeredCatalogs.verificationStatus, 'verified'),
        eq(schema.registeredCatalogs.status, 'accepted_indexed'),
      ));

    const results: Array<{ catalog_id: string; status: 'refreshed' | 'failed'; error?: string }> = [];
    for (const row of rows) {
      try {
        await this.refreshTrustedCatalog(row.catalogId);
        results.push({ catalog_id: row.catalogId, status: 'refreshed' });
      } catch (error) {
        results.push({
          catalog_id: row.catalogId,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      scanned_count: rows.length,
      refreshed_count: results.filter((result) => result.status === 'refreshed').length,
      failed_count: results.filter((result) => result.status === 'failed').length,
      results,
    };
  }

  async rotateToken(catalogId: string, meta: RequestMeta = {}): Promise<CatalogTokenRotationResult> {
    await this.requireCatalogToken(catalogId, meta.catalogToken);
    const token = issueCatalogToken();
    const issuedAt = new Date();
    await this.db
      .update(schema.registeredCatalogs)
      .set({
        catalogAccessTokenHash: hashCatalogToken(token),
        tokenIssuedAt: issuedAt,
        updatedAt: new Date(),
      })
      .where(and(
        eq(schema.registeredCatalogs.centerId, this.config.CENTER_ID),
        eq(schema.registeredCatalogs.catalogId, catalogId),
      ));

    return {
      ocp_version: '1.0',
      kind: 'CatalogTokenRotationResult',
      id: newId('cattoken'),
      center_id: this.config.CENTER_ID,
      catalog_id: catalogId,
      catalog_access_token: token,
      token_issued_at: issuedAt.toISOString(),
    };
  }

  async search(input: unknown, meta: RequestMeta = {}): Promise<CatalogSearchResult> {
    const request = catalogSearchRequestSchema.parse(input);
    const rows = await this.db
      .select()
      .from(schema.catalogIndexEntries)
      .where(and(
        eq(schema.catalogIndexEntries.centerId, this.config.CENTER_ID),
        eq(schema.catalogIndexEntries.entryStatus, 'active'),
      ));

    const terms = tokenize(request.query);
    const items = rows
      .map((row): CatalogSearchResultItem | null => {
        const projection = asRecord(row.searchProjection);
        if (!matchesCatalogFilters(row, projection, request.filters)) return null;

        const score = scoreCatalog(projection, terms);
        if (terms.length > 0 && score <= 0) return null;

        return {
          catalog_id: row.catalogId,
          catalog_name: row.catalogName,
          ...(row.description ? { description: row.description } : {}),
          score,
          matched_object_types: row.supportedObjectTypes,
          matched_query_capabilities: row.supportedQueryPacks,
          verification_status: row.verificationStatus,
          trust_tier: row.trustTier,
          health_status: row.healthStatus,
          route_hint: this.routeHintFromIndexRow(row),
          explain: request.explain ? explainCatalog(row, request.filters, terms, score) : [],
        };
      })
      .filter((item): item is CatalogSearchResultItem => item !== null)
      .sort((left, right) => right.score - left.score || left.catalog_name.localeCompare(right.catalog_name))
      .slice(0, request.limit);

    await this.db.insert(schema.catalogSearchAuditRecords).values({
      id: newId('cataudit'),
      centerId: this.config.CENTER_ID,
      requestPayload: request as unknown as Record<string, unknown>,
      resultCount: items.length,
      requesterKeyHash: meta.requesterKey ? hashText(meta.requesterKey) : null,
    });

    return {
      ocp_version: '1.0',
      kind: 'CatalogSearchResult',
      id: newId('catsearch'),
      center_id: this.config.CENTER_ID,
      result_count: items.length,
      items,
      explain: request.explain
        ? [`Scanned ${rows.length} active catalog index entries.`, `Returned ${items.length} catalog route hint(s).`]
        : [],
    };
  }

  async resolve(input: unknown): Promise<CatalogRouteHint> {
    const request = catalogResolveRequestSchema.parse(input);
    const [row] = await this.db
      .select()
      .from(schema.catalogIndexEntries)
      .where(and(
        eq(schema.catalogIndexEntries.centerId, this.config.CENTER_ID),
        eq(schema.catalogIndexEntries.catalogId, request.catalog_id),
        eq(schema.catalogIndexEntries.entryStatus, 'active'),
      ))
      .limit(1);

    if (!row) throw new AppError('not_found', `Catalog ${request.catalog_id} was not found in the active Center index`, 404);
    return this.routeHintFromIndexRow(row);
  }

  async getCatalog(catalogId: string) {
    const catalog = await this.findRegisteredCatalog(catalogId);
    if (!catalog) throw new AppError('not_found', `Catalog ${catalogId} is not registered`, 404);
    return catalog;
  }

  async getManifestSnapshot(catalogId: string) {
    const catalog = await this.findRegisteredCatalog(catalogId);
    if (!catalog?.activeSnapshotId) throw new AppError('not_found', `Catalog ${catalogId} has no active manifest snapshot`, 404);
    const [snapshot] = await this.db
      .select()
      .from(schema.catalogManifestSnapshots)
      .where(eq(schema.catalogManifestSnapshots.id, catalog.activeSnapshotId))
      .limit(1);
    if (!snapshot) throw new AppError('not_found', `Catalog ${catalogId} has no active manifest snapshot`, 404);
    return snapshot;
  }

  async getHealth(catalogId: string) {
    return this.db
      .select()
      .from(schema.catalogHealthChecks)
      .where(and(
        eq(schema.catalogHealthChecks.centerId, this.config.CENTER_ID),
        eq(schema.catalogHealthChecks.catalogId, catalogId),
      ));
  }

  private async refreshTrustedCatalog(catalogId: string): Promise<CatalogRefreshResult> {
    const catalog = await this.getCatalog(catalogId);
    if (catalog.verificationStatus !== 'verified') {
      throw new AppError('validation_error', `Catalog ${catalogId} is not verified`, 400);
    }

    return this.refreshCatalogWithoutToken(catalogId, catalog);
  }

  private async refreshCatalogWithoutToken(
    catalogId: string,
    catalog: Awaited<ReturnType<CatalogRegistryService['getCatalog']>>,
  ): Promise<CatalogRefreshResult> {
    const registration = await this.activeRegistrationPayload(catalogId);
    const { discovery, manifest } = await fetchCatalogProfile(catalog.wellKnownUrl);
    const warnings = validateFetchedCatalog(registration, discovery, manifest);
    const health = await this.checkHealth(catalogId, manifest.endpoints.query.url);
    const manifestUrl = discovery.manifest_url;
    const snapshotId = newId('catsnap');

    await this.db.insert(schema.catalogManifestSnapshots).values({
      id: snapshotId,
      centerId: this.config.CENTER_ID,
      catalogId,
      registrationId: catalog.activeRegistrationId ?? registration.id,
      manifestUrl,
      discoveryPayload: discovery as unknown as Record<string, unknown>,
      manifestPayload: manifest as unknown as Record<string, unknown>,
      manifestHash: hashJson(manifest),
      supportedObjectTypes: manifest.supported_object_types,
      queryCapabilities: manifest.query_capabilities,
      objectContractSummaries: objectContractSummaries(manifest),
    });

    await this.db
      .update(schema.registeredCatalogs)
      .set({
        activeSnapshotId: snapshotId,
        healthStatus: health.status,
        updatedAt: new Date(),
      })
      .where(and(
        eq(schema.registeredCatalogs.centerId, this.config.CENTER_ID),
        eq(schema.registeredCatalogs.catalogId, catalogId),
      ));

    const indexed = catalog.verificationStatus === 'verified' && health.status === 'healthy';
    if (indexed) {
      const projection = buildCatalogSearchProjection(registration, manifest, 'verified', catalog.trustTier, health.status);
      await this.upsertIndexEntry(registration, manifest, snapshotId, manifestUrl, projection, 'verified', catalog.trustTier, health.status);
    }

    return {
      ocp_version: '1.0',
      kind: 'CatalogRefreshResult',
      id: newId('catrefresh'),
      center_id: this.config.CENTER_ID,
      catalog_id: catalogId,
      status: 'refreshed',
      snapshot_id: snapshotId,
      health_status: health.status,
      indexed,
      warnings,
      refreshed_at: nowIso(),
    };
  }

  async listVerificationRecords(catalogId: string) {
    return this.db
      .select()
      .from(schema.catalogVerificationRecords)
      .where(and(
        eq(schema.catalogVerificationRecords.centerId, this.config.CENTER_ID),
        eq(schema.catalogVerificationRecords.catalogId, catalogId),
      ));
  }

  private async requireCatalogToken(catalogId: string, token: string | null | undefined) {
    const catalog = await this.getCatalog(catalogId);
    if (!verifyCatalogToken(token, catalog.catalogAccessTokenHash)) {
      throw new AppError('unauthorized', 'Missing or invalid catalog token', 401);
    }
    return catalog;
  }

  private async activeRegistrationPayload(catalogId: string): Promise<CatalogRegistration> {
    const catalog = await this.getCatalog(catalogId);
    if (!catalog.activeRegistrationId) throw new AppError('validation_error', `Catalog ${catalogId} has no active registration`, 400);
    const [record] = await this.db
      .select()
      .from(schema.catalogRegistrationRecords)
      .where(eq(schema.catalogRegistrationRecords.id, catalog.activeRegistrationId))
      .limit(1);
    if (!record) throw new AppError('validation_error', `Catalog ${catalogId} active registration is missing`, 400);
    return catalogRegistrationSchema.parse(record.registrationPayload);
  }

  private async indexActiveSnapshot(catalogId: string, verificationStatus: string, trustTier: string) {
    const catalog = await this.getCatalog(catalogId);
    if (!catalog.activeSnapshotId) throw new AppError('validation_error', `Catalog ${catalogId} has no active snapshot`, 400);
    const registration = await this.activeRegistrationPayload(catalogId);
    const snapshot = await this.getManifestSnapshot(catalogId);
    const manifest = catalogManifestSchema.parse(snapshot.manifestPayload);
    const discovery = asRecord(snapshot.discoveryPayload);
    const manifestUrl = stringValue(discovery.manifest_url) ?? snapshot.manifestUrl;
    const health = await this.checkHealth(catalogId, manifest.endpoints.query.url);
    const projection = buildCatalogSearchProjection(registration, manifest, verificationStatus, trustTier, health.status);
    await this.upsertIndexEntry(registration, manifest, catalog.activeSnapshotId, manifestUrl, projection, verificationStatus, trustTier, health.status);
  }

  private async findRegisteredCatalog(catalogId: string) {
    const [catalog] = await this.db
      .select()
      .from(schema.registeredCatalogs)
      .where(and(
        eq(schema.registeredCatalogs.centerId, this.config.CENTER_ID),
        eq(schema.registeredCatalogs.catalogId, catalogId),
      ))
      .limit(1);
    return catalog ?? null;
  }

  private async recordRegistration(registration: CatalogRegistration, result: CatalogRegistrationResult, meta: RequestMeta) {
    const [record] = await this.db
      .insert(schema.catalogRegistrationRecords)
      .values({
        id: registration.id,
        centerId: this.config.CENTER_ID,
        catalogId: registration.catalog_id,
        registrationVersion: registration.registration_version,
        status: result.status,
        registrationPayload: registration as unknown as Record<string, unknown>,
        resultPayload: result as unknown as Record<string, unknown>,
        sourceIp: meta.sourceIp ?? null,
        userAgent: meta.userAgent ?? null,
      })
      .onConflictDoUpdate({
        target: [
          schema.catalogRegistrationRecords.centerId,
          schema.catalogRegistrationRecords.catalogId,
          schema.catalogRegistrationRecords.registrationVersion,
        ],
        set: {
          status: result.status,
          resultPayload: result as unknown as Record<string, unknown>,
        },
      })
      .returning();

    if (!record) throw new AppError('internal_error', 'Failed to record Catalog registration', 500);
    return record;
  }

  private async checkHealth(catalogId: string, queryUrl: string) {
    const started = Date.now();
    try {
      const response = await fetch(queryUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: '', limit: 1, explain: false }),
      });
      const latencyMs = Date.now() - started;
      const status = response.ok ? 'healthy' : 'unhealthy';
      await this.db.insert(schema.catalogHealthChecks).values({
        id: newId('cathealth'),
        centerId: this.config.CENTER_ID,
        catalogId,
        checkedUrl: queryUrl,
        status,
        latencyMs,
        error: response.ok ? null : `${response.status} ${response.statusText}`,
      });
      return { status: status as 'healthy' | 'unhealthy', latencyMs };
    } catch (error) {
      await this.db.insert(schema.catalogHealthChecks).values({
        id: newId('cathealth'),
        centerId: this.config.CENTER_ID,
        catalogId,
        checkedUrl: queryUrl,
        status: 'unhealthy',
        latencyMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      });
      return { status: 'unhealthy' as const, latencyMs: Date.now() - started };
    }
  }

  private async upsertIndexEntry(
    registration: CatalogRegistration,
    manifest: CatalogManifest,
    snapshotId: string,
    manifestUrl: string,
    projection: Record<string, unknown>,
    verificationStatus: string,
    trustTier: string,
    healthStatus: string,
  ) {
    await this.db
      .insert(schema.catalogIndexEntries)
      .values({
        id: newId('catidx'),
        centerId: this.config.CENTER_ID,
        catalogId: registration.catalog_id,
        activeSnapshotId: snapshotId,
        entryStatus: 'active',
        catalogName: manifest.catalog_name,
        description: manifest.description ?? null,
        homepage: registration.homepage,
        manifestUrl,
        wellKnownUrl: registration.well_known_url,
        tags: registration.tags,
        domains: registration.claimed_domains,
        supportedObjectTypes: manifest.supported_object_types,
        supportedQueryModes: supportedQueryModes(manifest),
        supportedQueryPacks: supportedQueryPacks(manifest),
        supportedQueryLanguages: supportedQueryLanguages(manifest),
        contentLanguages: contentLanguages(manifest),
        supportsResolve: supportsResolve(manifest) ? 1 : 0,
        verificationStatus,
        trustTier,
        healthStatus,
        searchProjection: projection,
        explainProjection: {
          source: 'manifest',
          indexed_at: nowIso(),
        },
      })
      .onConflictDoUpdate({
        target: [schema.catalogIndexEntries.centerId, schema.catalogIndexEntries.catalogId],
        set: {
          activeSnapshotId: snapshotId,
          entryStatus: 'active',
          catalogName: manifest.catalog_name,
          description: manifest.description ?? null,
          homepage: registration.homepage,
          manifestUrl,
          wellKnownUrl: registration.well_known_url,
          tags: registration.tags,
          domains: registration.claimed_domains,
          supportedObjectTypes: manifest.supported_object_types,
          supportedQueryModes: supportedQueryModes(manifest),
          supportedQueryPacks: supportedQueryPacks(manifest),
          supportedQueryLanguages: supportedQueryLanguages(manifest),
          contentLanguages: contentLanguages(manifest),
          supportsResolve: supportsResolve(manifest) ? 1 : 0,
          verificationStatus,
          trustTier,
          healthStatus,
          searchProjection: projection,
          explainProjection: {
            source: 'manifest',
            indexed_at: nowIso(),
          },
          updatedAt: new Date(),
        },
      });
  }

  private routeHintFromIndexRow(row: typeof schema.catalogIndexEntries.$inferSelect): CatalogRouteHint {
    const resolveUrl = stringValue(asRecord(row.searchProjection).resolve_url);
    return {
      catalog_id: row.catalogId,
      catalog_name: row.catalogName,
      ...(row.description ? { description: row.description } : {}),
      manifest_url: row.manifestUrl,
      query_url: stringValue(asRecord(row.searchProjection).query_url) ?? row.manifestUrl.replace(/\/ocp\/manifest$/, '/ocp/query'),
      ...(resolveUrl ? { resolve_url: resolveUrl } : {}),
      supported_query_packs: row.supportedQueryPacks,
      supported_object_types: row.supportedObjectTypes,
      auth_requirements: { query: 'none', resolve: 'none' },
      metadata: {
        query_hints: {
          supported_query_modes: row.supportedQueryModes,
          supported_query_languages: row.supportedQueryLanguages,
          content_languages: row.contentLanguages,
        },
      },
      verification_status: row.verificationStatus,
      trust_tier: row.trustTier,
      health_status: row.healthStatus,
      cache_ttl_seconds: 86400,
      snapshot_id: row.activeSnapshotId,
      snapshot_fetched_at: row.updatedAt.toISOString(),
    };
  }

  private async buildVerificationChallenges(registration: CatalogRegistration) {
    const dns = await this.buildDnsChallenge(registration);
    const https = await this.buildHttpsChallenge(registration);
    return [dns, https];
  }

  private async buildDnsChallenge(registration: CatalogRegistration) {
    const token = newId('verify');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const domain = registration.claimed_domains[0]!;
    const challenge = {
      challenge_id: newId('catchal'),
      challenge_type: 'dns_txt' as const,
      domain,
      name: `_ocp-center.${domain}`,
      value: `ocp-center-verification=${this.config.CENTER_ID}:${token}`,
      expires_at: expiresAt.toISOString(),
    };

    await this.db.insert(schema.catalogVerificationRecords).values({
      id: challenge.challenge_id,
      centerId: this.config.CENTER_ID,
      catalogId: registration.catalog_id,
      challengeType: challenge.challenge_type,
      challengePayload: challenge,
      status: 'pending',
      verifiedDomain: null,
      expiresAt,
    });

    return challenge;
  }

  private async buildHttpsChallenge(registration: CatalogRegistration) {
    const token = newId('verify');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const domain = registration.claimed_domains[0]!;
    const challenge = {
      challenge_id: newId('catchal'),
      challenge_type: 'https_well_known' as const,
      domain,
      url: `https://${domain}/.well-known/ocp-center-verification/${this.config.CENTER_ID}.json`,
      token,
      expires_at: expiresAt.toISOString(),
    };

    await this.db.insert(schema.catalogVerificationRecords).values({
      id: challenge.challenge_id,
      centerId: this.config.CENTER_ID,
      catalogId: registration.catalog_id,
      challengeType: challenge.challenge_type,
      challengePayload: challenge,
      status: 'pending',
      verifiedDomain: null,
      expiresAt,
    });

    return challenge;
  }
}

function matchesCatalogFilters(
  row: typeof schema.catalogIndexEntries.$inferSelect,
  projection: Record<string, unknown>,
  filters: Record<string, unknown>,
) {
  if (filters.object_type && !row.supportedObjectTypes.includes(String(filters.object_type))) return false;
  if (filters.query_mode && !row.supportedQueryModes.includes(String(filters.query_mode))) return false;
  if (filters.query_pack && !row.supportedQueryPacks.includes(String(filters.query_pack))) return false;
  if (filters.supports_resolve !== undefined && Boolean(row.supportsResolve) !== filters.supports_resolve) return false;
  if (filters.verification_status && row.verificationStatus !== filters.verification_status) return false;
  if (filters.trust_tier && row.trustTier !== filters.trust_tier) return false;
  if (filters.health_status && row.healthStatus !== filters.health_status) return false;
  if (filters.domain && !row.domains.includes(String(filters.domain))) return false;
  if (filters.tag && !row.tags.includes(String(filters.tag))) return false;
  if (projection.hidden === true) return false;
  return true;
}

function tokenize(query: string) {
  return query.toLowerCase().split(/[\s,]+/).map((term) => term.trim()).filter(Boolean);
}

function scoreCatalog(projection: Record<string, unknown>, terms: string[]) {
  if (terms.length === 0) return 1;
  const text = String(projection.text ?? '').toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (text.includes(term)) score += 1;
    if (String(projection.catalog_name ?? '').toLowerCase().includes(term)) score += 2;
  }
  return Number(score.toFixed(4));
}

function explainCatalog(
  row: typeof schema.catalogIndexEntries.$inferSelect,
  filters: Record<string, unknown>,
  terms: string[],
  score: number,
) {
  const explain: string[] = [];
  if (terms.length > 0) explain.push(`Catalog metadata keyword score ${score} from term(s): ${terms.join(', ')}.`);
  if (filters.object_type) explain.push(`Catalog supports object_type ${filters.object_type}.`);
  if (filters.query_mode) explain.push(`Catalog supports query_mode ${filters.query_mode}.`);
  if (row.verificationStatus === 'verified') explain.push('Catalog domain is verified.');
  if (row.healthStatus === 'healthy') explain.push('Catalog query endpoint is healthy.');
  return explain.length ? explain : ['Matched active catalog index entry.'];
}

function hashJson(value: unknown) {
  return hashText(JSON.stringify(value));
}

function hashText(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
