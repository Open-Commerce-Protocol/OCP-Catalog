import type { Db } from '@ocp-catalog/db';
import { schema } from '@ocp-catalog/db';
import { newId } from '@ocp-catalog/shared';
import { and, eq, sql } from 'drizzle-orm';

export type SearchDocumentUpsertResult = {
  catalogEntryId: string;
  documentId: string;
  documentStatus: SearchDocumentStatus;
};

type SearchDocumentStatus = 'pending' | 'active' | 'inactive' | 'stale' | 'failed';

export class SearchDocumentUpsertService {
  constructor(private readonly db: Db) {}

  async upsertForCatalogEntry(catalogEntryId: string): Promise<SearchDocumentUpsertResult | null> {
    const row = await this.loadEntry(catalogEntryId);
    if (!row) return null;

    const projection = asRecord(row.projection);
    const searchText = buildSearchText(row, projection);
    const documentStatus: SearchDocumentStatus = row.entryStatus === 'active' && row.objectStatus === 'active'
      ? 'active'
      : 'inactive';
    const amount = numberValue(projection.amount);
    const listAmount = numberValue(projection.list_amount);
    const availabilityStatus = stringValue(projection.availability_status) ?? row.availabilityStatus ?? null;
    const qualityTier = stringValue(projection.quality_tier);

    const values = {
      catalogId: row.catalogId,
      catalogEntryId: row.entryId,
      commercialObjectId: row.commercialObjectId,
      providerId: row.providerId,
      objectId: row.objectId,
      objectType: row.objectType,
      documentStatus,
      title: stringValue(projection.title) ?? row.title,
      normalizedTitle: normalize(stringValue(projection.title) ?? row.title),
      summary: stringValue(projection.summary) ?? row.summary ?? null,
      brand: stringValue(projection.brand) ?? row.brand ?? null,
      normalizedBrand: normalize(stringValue(projection.brand) ?? row.brand),
      category: stringValue(projection.category) ?? row.category ?? null,
      normalizedCategory: normalize(stringValue(projection.category) ?? row.category),
      sku: stringValue(projection.sku) ?? null,
      normalizedSku: normalize(stringValue(projection.sku)),
      currency: stringValue(projection.currency) ?? row.currency ?? null,
      availabilityStatus,
      amount,
      listAmount,
      hasImage: booleanValue(projection.has_image),
      hasProductUrl: booleanValue(projection.has_product_url),
      discountPresent: booleanValue(projection.discount_present),
      qualityTier: qualityTier ?? null,
      availabilityRank: availabilityRank(availabilityStatus),
      qualityRank: qualityRank(qualityTier),
      searchText,
      searchVector: sql`to_tsvector('simple', ${searchText})`,
      facetPayload: buildFacetPayload(projection),
      rankingFeatures: buildRankingFeatures(projection, {
        availability_rank: availabilityRank(availabilityStatus),
        quality_rank: qualityRank(qualityTier),
      }),
      visibleAttributesPayload: visibleAttributes(projection),
      explainPayload: row.explainProjection,
      sourceUpdatedAt: row.objectUpdatedAt,
      indexedAt: new Date(),
      updatedAt: new Date(),
    };

    const [document] = await this.db
      .insert(schema.catalogSearchDocuments)
      .values({
        id: newId('sdoc'),
        ...values,
      })
      .onConflictDoUpdate({
        target: [schema.catalogSearchDocuments.catalogEntryId],
        set: values,
      })
      .returning({
        id: schema.catalogSearchDocuments.id,
        catalogEntryId: schema.catalogSearchDocuments.catalogEntryId,
        documentStatus: schema.catalogSearchDocuments.documentStatus,
      });

    if (!document) return null;

    return {
      catalogEntryId: document.catalogEntryId,
      documentId: document.id,
      documentStatus: document.documentStatus,
    };
  }

  async upsertForProvider(input: {
    catalogId: string;
    providerId: string;
  }) {
    const rows = await this.db
      .select({
        entryId: schema.catalogEntries.id,
      })
      .from(schema.catalogEntries)
      .where(and(
        eq(schema.catalogEntries.catalogId, input.catalogId),
        eq(schema.catalogEntries.providerId, input.providerId),
      ));

    const results: SearchDocumentUpsertResult[] = [];
    for (const row of rows) {
      const result = await this.upsertForCatalogEntry(row.entryId);
      if (result) results.push(result);
    }

    return results;
  }

  async deleteForCatalogEntry(catalogEntryId: string) {
    await this.db
      .delete(schema.catalogSearchDocuments)
      .where(eq(schema.catalogSearchDocuments.catalogEntryId, catalogEntryId));
  }

  private async loadEntry(catalogEntryId: string): Promise<LoadedSearchEntry | null> {
    const [row] = await this.db
      .select({
        entryId: schema.catalogEntries.id,
        catalogId: schema.catalogEntries.catalogId,
        commercialObjectId: schema.catalogEntries.commercialObjectId,
        objectType: schema.catalogEntries.objectType,
        providerId: schema.catalogEntries.providerId,
        objectId: schema.catalogEntries.objectId,
        entryStatus: schema.catalogEntries.entryStatus,
        title: schema.catalogEntries.title,
        summary: schema.catalogEntries.summary,
        brand: schema.catalogEntries.brand,
        category: schema.catalogEntries.category,
        currency: schema.catalogEntries.currency,
        availabilityStatus: schema.catalogEntries.availabilityStatus,
        searchText: schema.catalogEntries.searchText,
        projection: schema.catalogEntries.searchProjection,
        explainProjection: schema.catalogEntries.explainProjection,
        objectStatus: schema.commercialObjects.status,
        objectUpdatedAt: schema.commercialObjects.updatedAt,
      })
      .from(schema.catalogEntries)
      .innerJoin(schema.commercialObjects, eq(schema.catalogEntries.commercialObjectId, schema.commercialObjects.id))
      .where(eq(schema.catalogEntries.id, catalogEntryId))
      .limit(1);

    return row ?? null;
  }
}

type LoadedSearchEntry = {
  entryId: string;
  catalogId: string;
  commercialObjectId: string;
  objectType: string;
  providerId: string;
  objectId: string;
  entryStatus: 'active' | 'inactive' | 'rejected' | 'pending_verification';
  title: string;
  summary: string | null;
  brand: string | null;
  category: string | null;
  currency: string | null;
  availabilityStatus: string | null;
  searchText: string;
  projection: Record<string, unknown>;
  explainProjection: Record<string, unknown>;
  objectStatus: string;
  objectUpdatedAt: Date;
};

function buildSearchText(row: LoadedSearchEntry, projection: Record<string, unknown>) {
  const values = [
    stringValue(projection.title) ?? row.title,
    stringValue(projection.summary) ?? row.summary,
    stringValue(projection.brand) ?? row.brand,
    stringValue(projection.category) ?? row.category,
    stringValue(projection.sku),
    stringValue(projection.currency) ?? row.currency,
    stringValue(projection.availability_status) ?? row.availabilityStatus,
    stringValue(projection.provider_id) ?? row.providerId,
    stringValue(projection.object_id) ?? row.objectId,
    stringValue(projection.text) ?? row.searchText,
  ];

  return values
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
    .toLowerCase();
}

function buildFacetPayload(projection: Record<string, unknown>) {
  return {
    brand: stringValue(projection.brand) ?? null,
    category: stringValue(projection.category) ?? null,
    currency: stringValue(projection.currency) ?? null,
    availability_status: stringValue(projection.availability_status) ?? null,
    quality_tier: stringValue(projection.quality_tier) ?? null,
    has_image: booleanValue(projection.has_image),
    has_product_url: booleanValue(projection.has_product_url),
  };
}

function buildRankingFeatures(
  projection: Record<string, unknown>,
  ranks: {
    availability_rank: number;
    quality_rank: number;
  },
) {
  return {
    amount: numberValue(projection.amount),
    list_amount: numberValue(projection.list_amount),
    discount_present: booleanValue(projection.discount_present),
    has_image: booleanValue(projection.has_image),
    has_product_url: booleanValue(projection.has_product_url),
    availability_rank: ranks.availability_rank,
    quality_rank: ranks.quality_rank,
  };
}

function visibleAttributes(projection: Record<string, unknown>) {
  const hidden = new Set(['text']);
  return Object.fromEntries(Object.entries(projection).filter(([key]) => !hidden.has(key)));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown) {
  return value === true;
}

function normalize(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function availabilityRank(value: string | null | undefined) {
  switch (normalize(value)) {
    case 'in_stock':
      return 30;
    case 'low_stock':
      return 20;
    case 'preorder':
      return 10;
    case 'out_of_stock':
      return -10;
    default:
      return 0;
  }
}

function qualityRank(value: string | null | undefined) {
  switch (normalize(value)) {
    case 'rich':
      return 30;
    case 'standard':
      return 15;
    case 'basic':
      return 5;
    default:
      return 0;
  }
}
