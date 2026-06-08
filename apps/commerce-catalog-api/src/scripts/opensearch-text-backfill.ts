import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { schema } from '@ocp-catalog/db';
import { createCommerceCatalogWorkerRuntimeContext } from '../runtime/context';
import type { BulkWritableTextSearchIndexAdapter, TextIndexDocument } from '../search/retrieval/vector-index-adapter';

const context = createCommerceCatalogWorkerRuntimeContext({
  databasePoolMax: 2,
});

const limit = numberArg('--limit', 10_000);
const batchSize = numberArg('--batch-size', 500);
const dryRun = process.argv.includes('--dry-run');

if (!context.writableTextIndex) {
  console.error(JSON.stringify({ error: 'configured vector index does not support text indexing' }, null, 2));
  process.exit(1);
}

let lastId = stringArg('--after-id') ?? '';
let processed = 0;
let upserted = 0;

while (processed < limit) {
  const rows = await context.db
    .select({
      id: schema.catalogSearchDocuments.id,
      catalogEntryId: schema.catalogSearchDocuments.catalogEntryId,
      commercialObjectId: schema.catalogSearchDocuments.commercialObjectId,
      catalogId: schema.catalogSearchDocuments.catalogId,
      providerId: schema.catalogSearchDocuments.providerId,
      objectId: schema.catalogSearchDocuments.objectId,
      objectType: schema.catalogSearchDocuments.objectType,
      documentStatus: schema.catalogSearchDocuments.documentStatus,
      title: schema.catalogSearchDocuments.title,
      summary: schema.catalogSearchDocuments.summary,
      searchText: schema.catalogSearchDocuments.searchText,
      normalizedBrand: schema.catalogSearchDocuments.normalizedBrand,
      normalizedCategory: schema.catalogSearchDocuments.normalizedCategory,
      normalizedSku: schema.catalogSearchDocuments.normalizedSku,
      currency: schema.catalogSearchDocuments.currency,
      availabilityStatus: schema.catalogSearchDocuments.availabilityStatus,
      amount: schema.catalogSearchDocuments.amount,
      hasImage: schema.catalogSearchDocuments.hasImage,
      qualityRank: schema.catalogSearchDocuments.qualityRank,
      availabilityRank: schema.catalogSearchDocuments.availabilityRank,
      visibleAttributesPayload: schema.catalogSearchDocuments.visibleAttributesPayload,
    })
    .from(schema.catalogSearchDocuments)
    .where(and(
      eq(schema.catalogSearchDocuments.catalogId, context.config.CATALOG_ID),
      gt(schema.catalogSearchDocuments.id, lastId),
    ))
    .orderBy(asc(schema.catalogSearchDocuments.id))
    .limit(Math.min(batchSize, limit - processed));

  if (rows.length === 0) break;

  const documents = rows.map((row): TextIndexDocument => ({
    documentId: row.id,
    catalogEntryId: row.catalogEntryId,
    commercialObjectId: row.commercialObjectId,
    catalogId: row.catalogId,
    providerId: row.providerId,
    objectId: row.objectId,
    objectType: row.objectType,
    documentStatus: row.documentStatus,
    title: row.title,
    summary: row.summary,
    searchText: row.searchText,
    normalizedBrand: row.normalizedBrand,
    normalizedCategory: row.normalizedCategory,
    normalizedSku: row.normalizedSku,
    currency: row.currency,
    availabilityStatus: row.availabilityStatus,
    amount: row.amount,
    hasImage: row.hasImage,
    qualityRank: row.qualityRank,
    availabilityRank: row.availabilityRank,
    visibleAttributesPayload: row.visibleAttributesPayload,
  }));

  if (!dryRun) {
    if (isBulkTextIndex(context.writableTextIndex)) {
      await context.writableTextIndex.bulkUpsertText(documents);
    } else {
      for (const document of documents) {
        await context.writableTextIndex.upsertText(document);
      }
    }
    upserted += documents.length;
  }

  for (const row of rows) {
    processed += 1;
    lastId = row.id;
  }

  console.log(JSON.stringify({ processed, upserted, last_id: lastId, dry_run: dryRun }));
}

await context.db.execute(sql`select 1`);
console.log(JSON.stringify({ status: 'done', processed, upserted, last_id: lastId, dry_run: dryRun }, null, 2));
process.exit(0);

function numberArg(name: string, fallback: number) {
  const prefix = `${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function stringArg(name: string) {
  const prefix = `${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function isBulkTextIndex(value: unknown): value is BulkWritableTextSearchIndexAdapter {
  return Boolean(value && typeof value === 'object' && 'bulkUpsertText' in value);
}
