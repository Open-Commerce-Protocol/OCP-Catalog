import type { CatalogDb as Db } from '@ocp-catalog/catalog-db';
import { catalogSchema as schema } from '@ocp-catalog/catalog-db';
import { newId } from '@ocp-catalog/shared';
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import type {
  BulkWritableTextSearchIndexAdapter,
  TextIndexDocument,
  WritableTextSearchIndexAdapter,
  WritableVectorIndexAdapter,
} from '../retrieval/vector-index-adapter';

export type SearchDocumentUpsertResult = {
  catalogEntryId: string;
  documentId: string;
  documentStatus: SearchDocumentStatus;
};

export type ProviderCatalogEntryPage = {
  entries: Array<{
    catalogEntryId: string;
    commercialObjectId: string;
    updatedAt: Date;
  }>;
  nextCursor: {
    updatedAt: Date;
    catalogEntryId: string;
  } | null;
};

type SearchDocumentStatus = 'pending' | 'active' | 'inactive' | 'stale' | 'failed';

export type SearchDocumentSnapshot = {
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
  objectUpdatedAt: string | Date;
};

export class SearchDocumentUpsertService {
  constructor(
    private readonly db: Db,
    private readonly writableVectorIndex?: WritableVectorIndexAdapter,
    private readonly writableTextIndex?: WritableTextSearchIndexAdapter,
  ) {}

  async upsertForCatalogEntry(catalogEntryId: string): Promise<SearchDocumentUpsertResult | null> {
    const row = await this.loadEntry(catalogEntryId);
    if (!row) return null;

    return this.upsertLoadedEntry(row);
  }

  async upsertForSnapshot(snapshot: SearchDocumentSnapshot): Promise<SearchDocumentUpsertResult | null> {
    return this.upsertLoadedEntry(snapshotToLoadedEntry(snapshot));
  }

  async upsertForSnapshots(snapshots: SearchDocumentSnapshot[]): Promise<SearchDocumentUpsertResult[]> {
    const rows = snapshots.map(snapshotToLoadedEntry);
    return this.upsertLoadedEntries(rows);
  }

  private async upsertLoadedEntry(row: LoadedSearchEntry): Promise<SearchDocumentUpsertResult | null> {
    const values = buildDocumentValues(row);

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

    if (this.writableTextIndex) {
      await this.writableTextIndex.upsertText(toTextIndexDocument(document.id, row, values));
    }

    return {
      catalogEntryId: document.catalogEntryId,
      documentId: document.id,
      documentStatus: document.documentStatus,
    };
  }

  async upsertForCatalogEntries(catalogEntryIds: string[]): Promise<SearchDocumentUpsertResult[]> {
    const rows = await this.loadEntries(unique(catalogEntryIds));
    return this.upsertLoadedEntries(rows);
  }

  private async upsertLoadedEntries(rows: LoadedSearchEntry[]): Promise<SearchDocumentUpsertResult[]> {
    if (rows.length === 0) return [];
    const valuesByEntryId = new Map(rows.map((row) => [row.entryId, buildDocumentValues(row)]));
    const documents = await this.db
      .insert(schema.catalogSearchDocuments)
      .values(rows.map((row) => ({
        id: newId('sdoc'),
        ...valuesByEntryId.get(row.entryId)!,
      })))
      .onConflictDoUpdate({
        target: [schema.catalogSearchDocuments.catalogEntryId],
        set: {
          catalogId: sql`excluded.catalog_id`,
          catalogEntryId: sql`excluded.catalog_entry_id`,
          commercialObjectId: sql`excluded.commercial_object_id`,
          providerId: sql`excluded.provider_id`,
          objectId: sql`excluded.object_id`,
          objectType: sql`excluded.object_type`,
          documentStatus: sql`excluded.document_status`,
          title: sql`excluded.title`,
          normalizedTitle: sql`excluded.normalized_title`,
          summary: sql`excluded.summary`,
          brand: sql`excluded.brand`,
          normalizedBrand: sql`excluded.normalized_brand`,
          category: sql`excluded.category`,
          normalizedCategory: sql`excluded.normalized_category`,
          sku: sql`excluded.sku`,
          normalizedSku: sql`excluded.normalized_sku`,
          currency: sql`excluded.currency`,
          availabilityStatus: sql`excluded.availability_status`,
          amount: sql`excluded.amount`,
          listAmount: sql`excluded.list_amount`,
          hasImage: sql`excluded.has_image`,
          hasProductUrl: sql`excluded.has_product_url`,
          discountPresent: sql`excluded.discount_present`,
          qualityTier: sql`excluded.quality_tier`,
          availabilityRank: sql`excluded.availability_rank`,
          qualityRank: sql`excluded.quality_rank`,
          searchText: sql`excluded.search_text`,
          searchVector: sql`excluded.search_vector`,
          facetPayload: sql`excluded.facet_payload`,
          rankingFeatures: sql`excluded.ranking_features`,
          visibleAttributesPayload: sql`excluded.visible_attributes_payload`,
          explainPayload: sql`excluded.explain_payload`,
          sourceUpdatedAt: sql`excluded.source_updated_at`,
          indexedAt: sql`excluded.indexed_at`,
          updatedAt: sql`excluded.updated_at`,
        },
      })
      .returning({
        id: schema.catalogSearchDocuments.id,
        catalogEntryId: schema.catalogSearchDocuments.catalogEntryId,
        documentStatus: schema.catalogSearchDocuments.documentStatus,
      });

    if (this.writableTextIndex) {
      const rowByEntryId = new Map(rows.map((row) => [row.entryId, row]));
      const textDocuments = documents
        .map((document) => {
          const row = rowByEntryId.get(document.catalogEntryId);
          const values = valuesByEntryId.get(document.catalogEntryId);
          return row && values ? toTextIndexDocument(document.id, row, values) : null;
        })
        .filter((document): document is TextIndexDocument => document !== null);
      if (isBulkWritableTextIndex(this.writableTextIndex)) {
        await this.writableTextIndex.bulkUpsertText(textDocuments);
      } else {
        await Promise.all(textDocuments.map((document) => this.writableTextIndex!.upsertText(document)));
      }
    }

    return documents.map((document) => ({
      catalogEntryId: document.catalogEntryId,
      documentId: document.id,
      documentStatus: document.documentStatus,
    }));
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

  async listProviderCatalogEntryPage(input: {
    catalogId: string;
    providerId: string;
    limit: number;
    cursor?: {
      updatedAt: Date;
      catalogEntryId: string;
    } | null;
  }): Promise<ProviderCatalogEntryPage> {
    const conditions = [
      eq(schema.catalogEntries.catalogId, input.catalogId),
      eq(schema.catalogEntries.providerId, input.providerId),
    ];
    if (input.cursor) {
      conditions.push(or(
        lt(schema.catalogEntries.updatedAt, input.cursor.updatedAt),
        and(
          eq(schema.catalogEntries.updatedAt, input.cursor.updatedAt),
          lt(schema.catalogEntries.id, input.cursor.catalogEntryId),
        ),
      )!);
    }

    const rows = await this.db
      .select({
        catalogEntryId: schema.catalogEntries.id,
        commercialObjectId: schema.catalogEntries.commercialObjectId,
        updatedAt: schema.catalogEntries.updatedAt,
      })
      .from(schema.catalogEntries)
      .where(and(...conditions))
      .orderBy(desc(schema.catalogEntries.updatedAt), desc(schema.catalogEntries.id))
      .limit(input.limit + 1);

    const entries = rows.slice(0, input.limit);
    const last = entries.at(-1);

    return {
      entries,
      nextCursor: rows.length > input.limit && last
        ? {
            updatedAt: last.updatedAt,
            catalogEntryId: last.catalogEntryId,
          }
        : null,
    };
  }

  async deleteForCatalogEntry(catalogEntryId: string) {
    const [document] = await this.db
      .select({
        id: schema.catalogSearchDocuments.id,
      })
      .from(schema.catalogSearchDocuments)
      .where(eq(schema.catalogSearchDocuments.catalogEntryId, catalogEntryId))
      .limit(1);

    await this.db
      .delete(schema.catalogSearchDocuments)
      .where(eq(schema.catalogSearchDocuments.catalogEntryId, catalogEntryId));

    if (document && this.writableVectorIndex) {
      await this.writableVectorIndex.delete(document.id);
    }
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

  private async loadEntries(catalogEntryIds: string[]): Promise<LoadedSearchEntry[]> {
    if (catalogEntryIds.length === 0) return [];
    return this.db
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
      .where(inArray(schema.catalogEntries.id, catalogEntryIds));
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

type SearchDocumentValues = ReturnType<typeof buildDocumentValues>;

function buildDocumentValues(row: LoadedSearchEntry) {
  const projection = asRecord(row.projection);
  const searchText = buildSearchText(row, projection);
  const documentStatus: SearchDocumentStatus = row.entryStatus === 'active' && row.objectStatus === 'active'
    ? 'active'
    : 'inactive';
  const amount = numberValue(projection.amount);
  const listAmount = numberValue(projection.list_amount);
  const availabilityStatus = stringValue(projection.availability_status) ?? row.availabilityStatus ?? null;
  const qualityTier = stringValue(projection.quality_tier);

  return {
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
}

function toTextIndexDocument(documentId: string, row: LoadedSearchEntry, values: SearchDocumentValues): TextIndexDocument {
  return {
    documentId,
    catalogEntryId: row.entryId,
    commercialObjectId: row.commercialObjectId,
    catalogId: row.catalogId,
    providerId: row.providerId,
    objectId: row.objectId,
    objectType: row.objectType,
    documentStatus: values.documentStatus,
    title: values.title,
    summary: values.summary,
    searchText: values.searchText,
    normalizedBrand: values.normalizedBrand,
    normalizedCategory: values.normalizedCategory,
    normalizedSku: values.normalizedSku,
    currency: values.currency,
    availabilityStatus: values.availabilityStatus,
    amount: values.amount,
    hasImage: values.hasImage,
    qualityRank: values.qualityRank,
    availabilityRank: values.availabilityRank,
    visibleAttributesPayload: values.visibleAttributesPayload,
  };
}

function isBulkWritableTextIndex(input: WritableTextSearchIndexAdapter): input is BulkWritableTextSearchIndexAdapter {
  return 'bulkUpsertText' in input && typeof input.bulkUpsertText === 'function';
}

function snapshotToLoadedEntry(snapshot: SearchDocumentSnapshot): LoadedSearchEntry {
  return {
    ...snapshot,
    objectUpdatedAt: snapshot.objectUpdatedAt instanceof Date
      ? snapshot.objectUpdatedAt
      : new Date(snapshot.objectUpdatedAt),
  };
}

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

function unique<T>(values: T[]) {
  return [...new Set(values)];
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
