import type { AppConfig } from '@ocp-catalog/config';
import type { Db } from '@ocp-catalog/db';
import { schema } from '@ocp-catalog/db';
import {
  commercialObjectSchema,
  objectSyncRequestSchema,
  type CommercialObject,
  type ObjectSyncItemResult,
  type ObjectSyncResult,
} from '@ocp-catalog/ocp-schema';
import { AppError, newId } from '@ocp-catalog/shared';
import { and, eq } from 'drizzle-orm';
import { isPresent, readDescriptorField } from './field-ref';
import type { CatalogScenarioModule, SearchProjection } from './scenario';
import type { RegistrationService } from './registration-service';
import type { CatalogEmbeddingService } from './embedding-service';

const MAX_DESCRIPTOR_PAYLOAD_BYTES = 64 * 1024;

export class ObjectSyncService {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly registrations: RegistrationService,
    private readonly scenario: CatalogScenarioModule,
    private readonly embeddings?: CatalogEmbeddingService,
  ) {}

  async sync(input: unknown): Promise<ObjectSyncResult> {
    const request = objectSyncRequestSchema.parse(input);
    if (request.catalog_id !== this.config.CATALOG_ID) {
      throw new AppError('validation_error', `catalog_id must be ${this.config.CATALOG_ID}`, 400);
    }

    const providerState = await this.registrations.findProviderState(request.provider_id);
    if (!providerState || providerState.status !== 'active') {
      throw new AppError('validation_error', `Provider ${request.provider_id} is not active`, 400);
    }
    if (providerState.activeRegistrationVersion !== request.registration_version) {
      throw new AppError('validation_error', 'registration_version does not match active provider contract state', 400, {
        active_registration_version: providerState.activeRegistrationVersion,
      });
    }

    const batchId = request.batch_id ?? newId('batch');
    const batchRowId = newId('syncbatch');
    await this.db.insert(schema.objectSyncBatches).values({
      id: batchRowId,
      catalogId: request.catalog_id,
      providerId: request.provider_id,
      registrationVersion: request.registration_version,
      batchId,
      status: 'rejected',
      requestPayload: request as unknown as Record<string, unknown>,
    });

    const items: ObjectSyncItemResult[] = [];
    for (const item of request.objects) {
      const result = await this.syncOne(item, {
        catalogId: request.catalog_id,
        providerId: request.provider_id,
        registrationVersion: request.registration_version,
        scenario: this.scenario,
      });
      items.push(result);

      await this.db.insert(schema.objectSyncItemResults).values({
        id: newId('syncitem'),
        syncBatchId: batchRowId,
        objectId: result.object_id ?? null,
        status: result.status,
        commercialObjectId: result.commercial_object_id ?? null,
        catalogEntryId: result.catalog_entry_id ?? null,
        errors: result.errors,
        warnings: result.warnings,
      });
    }

    const acceptedCount = items.filter((item) => item.status === 'accepted').length;
    const rejectedCount = items.length - acceptedCount;
    const status = acceptedCount === 0 ? 'rejected' : rejectedCount > 0 ? 'partial' : 'accepted';
    const result: ObjectSyncResult = {
      ocp_version: '1.0',
      kind: 'ObjectSyncResult',
      id: newId('syncres'),
      catalog_id: request.catalog_id,
      provider_id: request.provider_id,
      registration_version: request.registration_version,
      batch_id: batchId,
      status,
      accepted_count: acceptedCount,
      rejected_count: rejectedCount,
      error_count: rejectedCount,
      items,
    };

    await this.db
      .update(schema.objectSyncBatches)
      .set({
        status,
        acceptedCount,
        rejectedCount,
        errorCount: rejectedCount,
        resultPayload: result as unknown as Record<string, unknown>,
        finishedAt: new Date(),
      })
      .where(eq(schema.objectSyncBatches.id, batchRowId));

    return result;
  }

  async listProviderObjects(providerId: string) {
    return this.db
      .select({
        id: schema.commercialObjects.id,
        catalog_id: schema.commercialObjects.catalogId,
        provider_id: schema.commercialObjects.providerId,
        object_id: schema.commercialObjects.objectId,
        object_type: schema.commercialObjects.objectType,
        title: schema.commercialObjects.title,
        summary: schema.commercialObjects.summary,
        status: schema.commercialObjects.status,
        source_url: schema.commercialObjects.sourceUrl,
        updated_at: schema.commercialObjects.updatedAt,
      })
      .from(schema.commercialObjects)
      .where(and(
        eq(schema.commercialObjects.catalogId, this.config.CATALOG_ID),
        eq(schema.commercialObjects.providerId, providerId),
      ));
  }

  async getObject(objectId: string) {
    const [object] = await this.db
      .select()
      .from(schema.commercialObjects)
      .where(eq(schema.commercialObjects.id, objectId))
      .limit(1);

    if (!object) throw new AppError('not_found', `Commercial object ${objectId} was not found`, 404);
    return object;
  }

  private async syncOne(input: unknown, context: SyncContext): Promise<ObjectSyncItemResult> {
    const parsed = commercialObjectSchema.safeParse(input);
    if (!parsed.success) {
      return {
        object_id: extractObjectId(input),
        status: 'rejected',
        errors: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'object'}: ${issue.message}`),
        warnings: [],
      };
    }

    const object = parsed.data;
    const errors = validateCommercialObject(object, context);
    if (errors.length > 0) {
      return {
        object_id: object.object_id,
        status: 'rejected',
        errors,
        warnings: [],
      };
    }

    const projection = this.scenario.buildSearchProjection(object);
    const explainProjection = this.scenario.buildExplainProjection?.(object, projection) ?? buildDefaultExplainProjection(object, projection);
    const [commercialObject] = await this.db
      .insert(schema.commercialObjects)
      .values({
        id: newId('cobj'),
        catalogId: context.catalogId,
        providerId: context.providerId,
        objectId: object.object_id,
        objectType: object.object_type,
        title: projection.title,
        summary: projection.summary ?? object.summary ?? null,
        status: object.status,
        sourceUrl: object.source_url ?? stringValue(projection.source_url) ?? null,
        rawObject: object as unknown as Record<string, unknown>,
      })
      .onConflictDoUpdate({
        target: [
          schema.commercialObjects.catalogId,
          schema.commercialObjects.providerId,
          schema.commercialObjects.objectId,
        ],
        set: {
          objectType: object.object_type,
          title: projection.title,
          summary: projection.summary ?? object.summary ?? null,
          status: object.status,
          sourceUrl: object.source_url ?? stringValue(projection.source_url) ?? null,
          rawObject: object as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!commercialObject) {
      return {
        object_id: object.object_id,
        status: 'rejected',
        errors: ['Failed to upsert commercial object'],
        warnings: [],
      };
    }

    await this.db
      .delete(schema.descriptorInstances)
      .where(eq(schema.descriptorInstances.commercialObjectId, commercialObject.id));

    if (object.descriptors.length > 0) {
      await this.db.insert(schema.descriptorInstances).values(object.descriptors.map((descriptor) => ({
        id: newId('desc'),
        commercialObjectId: commercialObject.id,
        packId: descriptor.pack_id,
        schemaUri: descriptor.schema_uri ?? null,
        payload: descriptor.data,
      })));
    }

    const [entry] = await this.db
      .insert(schema.catalogEntries)
      .values({
        id: newId('centry'),
        catalogId: context.catalogId,
        commercialObjectId: commercialObject.id,
        objectType: object.object_type,
        providerId: context.providerId,
        objectId: object.object_id,
        entryStatus: object.status === 'active' ? 'active' : 'inactive',
        contractMatchStatus: 'matched',
        title: projection.title,
        summary: stringValue(projection.summary) ?? object.summary ?? null,
        brand: stringValue(projection.brand) ?? null,
        category: stringValue(projection.category) ?? null,
        currency: stringValue(projection.currency) ?? null,
        availabilityStatus: stringValue(projection.availability_status) ?? null,
        searchText: buildSearchText(projection),
        searchProjection: projection as unknown as Record<string, unknown>,
        explainProjection,
      })
      .onConflictDoUpdate({
        target: [schema.catalogEntries.commercialObjectId],
        set: {
          objectType: object.object_type,
          providerId: context.providerId,
          objectId: object.object_id,
          entryStatus: object.status === 'active' ? 'active' : 'inactive',
          contractMatchStatus: 'matched',
          title: projection.title,
          summary: stringValue(projection.summary) ?? object.summary ?? null,
          brand: stringValue(projection.brand) ?? null,
          category: stringValue(projection.category) ?? null,
          currency: stringValue(projection.currency) ?? null,
          availabilityStatus: stringValue(projection.availability_status) ?? null,
          searchText: buildSearchText(projection),
          searchProjection: projection as unknown as Record<string, unknown>,
          explainProjection,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!entry) {
      return {
        object_id: object.object_id,
        status: 'rejected',
        commercial_object_id: commercialObject.id,
        errors: ['Failed to upsert catalog entry'],
        warnings: [],
      };
    }

    await this.embeddings?.upsertEntryEmbedding({
      catalogId: context.catalogId,
      catalogEntryId: entry.id,
      object,
      projection,
    });

    return {
      object_id: object.object_id,
      status: 'accepted',
      commercial_object_id: commercialObject.id,
      catalog_entry_id: entry.id,
      errors: [],
      warnings: [],
    };
  }
}

type SyncContext = {
  catalogId: string;
  providerId: string;
  registrationVersion: number;
  scenario: CatalogScenarioModule;
};

function validateCommercialObject(object: CommercialObject, context: SyncContext) {
  const errors: string[] = [];

  if (object.provider_id !== context.providerId) errors.push('provider_id does not match sync request');

  for (const descriptor of object.descriptors) {
    const payloadSize = JSON.stringify(descriptor.data).length;
    if (payloadSize > MAX_DESCRIPTOR_PAYLOAD_BYTES) {
      errors.push(`Descriptor ${descriptor.pack_id} exceeds ${MAX_DESCRIPTOR_PAYLOAD_BYTES} bytes`);
      continue;
    }

    const packResult = context.scenario.validateDescriptorPack(descriptor.pack_id, descriptor.data);
    if (!packResult.ok) errors.push(...packResult.errors);
  }

  const matchingContracts = context.scenario.objectContracts().filter((contract) => (
    contract.required_fields.every((requirement) => (
      typeof requirement === 'string'
        ? isPresent(readDescriptorField(object, requirement))
        : requirement.some((fieldRef) => isPresent(readDescriptorField(object, fieldRef)))
    ))
  ));

  if (matchingContracts.length === 0) {
    errors.push('Object does not satisfy any published object contract.');
  }

  return errors;
}

function buildDefaultExplainProjection(object: CommercialObject, projection: SearchProjection) {
  return {
    indexed_fields: Object.keys(projection).filter((key) => key !== 'text'),
    descriptor_packs: object.descriptors.map((descriptor) => descriptor.pack_id),
  };
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function buildSearchText(projection: SearchProjection) {
  return [
    stringValue(projection.title),
    stringValue(projection.summary),
    stringValue(projection.brand),
    stringValue(projection.category),
    stringValue(projection.currency),
    stringValue(projection.availability_status),
    stringValue(projection.provider_id),
    stringValue(projection.object_id),
    stringValue(projection.text),
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
    .toLowerCase();
}

function extractObjectId(input: unknown) {
  if (typeof input === 'object' && input !== null && 'object_id' in input) {
    const value = (input as { object_id?: unknown }).object_id;
    return typeof value === 'string' ? value : undefined;
  }

  return undefined;
}
