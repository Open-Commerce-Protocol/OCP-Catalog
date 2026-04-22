import type { AppConfig } from '@ocp-catalog/config';
import type { Db } from '@ocp-catalog/db';
import { schema } from '@ocp-catalog/db';
import {
  resolveRequestSchema,
  type ResolvableReference,
} from '@ocp-catalog/ocp-schema';
import { AppError, newId, nowIso } from '@ocp-catalog/shared';
import { and, eq } from 'drizzle-orm';
import { asProjection, visibleAttributes } from './projection';
import type { CatalogScenarioModule } from './scenario';

const REFERENCE_TTL_MS = 15 * 60 * 1000;

export class ResolveService {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly scenario: CatalogScenarioModule,
  ) {}

  async resolve(input: unknown): Promise<ResolvableReference> {
    const request = resolveRequestSchema.parse(input);
    const catalogId = request.catalog_id ?? this.config.CATALOG_ID;
    if (catalogId !== this.config.CATALOG_ID) {
      throw new AppError('validation_error', `catalog_id must be ${this.config.CATALOG_ID}`, 400);
    }

    const [row] = await this.db
      .select({
        entryId: schema.catalogEntries.id,
        commercialObjectId: schema.commercialObjects.id,
        catalogId: schema.catalogEntries.catalogId,
        objectId: schema.commercialObjects.objectId,
        objectType: schema.catalogEntries.objectType,
        providerId: schema.commercialObjects.providerId,
        title: schema.commercialObjects.title,
        objectUpdatedAt: schema.commercialObjects.updatedAt,
        projection: schema.catalogEntries.searchProjection,
      })
      .from(schema.catalogEntries)
      .innerJoin(schema.commercialObjects, eq(schema.catalogEntries.commercialObjectId, schema.commercialObjects.id))
      .where(and(
        eq(schema.catalogEntries.id, request.entry_id),
        eq(schema.catalogEntries.catalogId, catalogId),
        eq(schema.catalogEntries.entryStatus, 'active'),
        eq(schema.commercialObjects.status, 'active'),
      ))
      .limit(1);

    if (!row) throw new AppError('not_found', `Active catalog entry ${request.entry_id} was not found`, 404);

    const [providerState] = await this.db
      .select()
      .from(schema.providerContractStates)
      .where(and(
        eq(schema.providerContractStates.catalogId, catalogId),
        eq(schema.providerContractStates.providerId, row.providerId),
      ))
      .limit(1);

    const projection = asProjection(row.projection);
    const resolvedAt = nowIso();
    const expiresAt = new Date(Date.now() + REFERENCE_TTL_MS).toISOString();
    const reference: ResolvableReference = {
      ocp_version: '1.0',
      kind: 'ResolvableReference',
      id: newId('ref'),
      catalog_id: row.catalogId,
      entry_id: row.entryId,
      commercial_object_id: row.commercialObjectId,
      object_id: row.objectId,
      object_type: row.objectType,
      provider_id: row.providerId,
      ...(providerState ? { registration_version: providerState.activeRegistrationVersion } : {}),
      title: row.title,
      visible_attributes: visibleAttributes(projection),
      action_bindings: this.scenario.buildResolveActions?.(projection) ?? [],
      freshness: {
        object_updated_at: row.objectUpdatedAt.toISOString(),
        resolved_at: resolvedAt,
      },
      expires_at: expiresAt,
    };

    await this.db.insert(schema.resolvableReferences).values({
      id: reference.id,
      catalogId: row.catalogId,
      commercialObjectId: row.commercialObjectId,
      catalogEntryId: row.entryId,
      referenceType: 'commercial_object',
      resolvedTitle: row.title,
      payload: reference as unknown as Record<string, unknown>,
      expiresAt: new Date(expiresAt),
    });

    return reference;
  }
}
