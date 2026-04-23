import type { AppConfig } from '@ocp-catalog/config';
import type { Db } from '@ocp-catalog/db';
import { schema } from '@ocp-catalog/db';
import { AppError, newId } from '@ocp-catalog/shared';
import { desc, eq } from 'drizzle-orm';
import type { CatalogClient } from './catalog-client';
import type { ProductRepository } from './product-repository';
import { buildObjectSyncRequest, buildProviderRegistration } from './provider-mapper';

const DEFAULT_SYNC_BATCH_SIZE = 25;

export class ProviderService {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly products: ProductRepository,
    private readonly catalog: CatalogClient,
  ) {}

  async getCatalogStatus() {
    const providerState = await this.findCatalogProviderState();
    const products = await this.products.listProducts();
    const localQuality = summarizeProductQuality(products);

    return {
      provider_id: this.config.COMMERCE_PROVIDER_ID,
      catalog_id: this.config.CATALOG_ID,
      status: providerState?.status ?? 'unregistered',
      active_registration_version: providerState?.active_registration_version ?? null,
      next_registration_version: (providerState?.active_registration_version ?? 0) + 1,
      sync_batch_size: DEFAULT_SYNC_BATCH_SIZE,
      local_quality: localQuality,
      publish_readiness: buildPublishReadiness(localQuality),
      catalog_quality: providerState?.catalog_quality ?? null,
    };
  }

  async registerToCatalog(registrationVersion?: number) {
    const resolvedVersion = registrationVersion ?? await this.resolveNextRegistrationVersion();
    const request = buildProviderRegistration(this.config, resolvedVersion);
    return this.recordRun('register', resolvedVersion, null, request, () => this.catalog.registerProvider(request));
  }

  async publishToCatalog(registrationVersion?: number) {
    const registerRun = await this.registerToCatalog(registrationVersion);
    if (registerRun.status !== 'succeeded') {
      return {
        provider_id: this.config.COMMERCE_PROVIDER_ID,
        registration_version: registerRun.registrationVersion,
        status: 'failed',
        register_run: registerRun,
        sync_run: null,
      };
    }

    const syncRun = await this.syncAll();
    return {
      provider_id: this.config.COMMERCE_PROVIDER_ID,
      registration_version: registerRun.registrationVersion,
      status: syncRun.status,
      register_run: registerRun,
      sync_run: syncRun,
    };
  }

  async syncAll(registrationVersion?: number) {
    const resolvedVersion = registrationVersion ?? await this.resolveActiveRegistrationVersion();
    const products = await this.products.listProducts();
    if (products.length === 0) {
      throw new AppError('validation_error', 'No provider products are available to sync', 400);
    }

    const chunkCount = Math.max(1, Math.ceil(products.length / DEFAULT_SYNC_BATCH_SIZE));
    const request = {
      provider_id: this.config.COMMERCE_PROVIDER_ID,
      catalog_id: this.config.CATALOG_ID,
      registration_version: resolvedVersion,
      object_count: products.length,
      batch_size: DEFAULT_SYNC_BATCH_SIZE,
      chunk_count: chunkCount,
    };

    return this.recordRun('sync_all', resolvedVersion, null, request, async () => {
      const batches = [];

      for (let index = 0; index < chunkCount; index += 1) {
        const chunk = products.slice(index * DEFAULT_SYNC_BATCH_SIZE, (index + 1) * DEFAULT_SYNC_BATCH_SIZE);
        const syncRequest = buildObjectSyncRequest(this.config, resolvedVersion, chunk, {
          batchId: `provider_batch_${Date.now()}_${index + 1}`,
        });
        const result = await this.catalog.syncObjects(syncRequest);
        batches.push(result);
      }

      const acceptedCount = batches.reduce((sum, batch) => sum + numberValue(batch.accepted_count), 0);
      const rejectedCount = batches.reduce((sum, batch) => sum + numberValue(batch.rejected_count), 0);

      return {
        provider_id: this.config.COMMERCE_PROVIDER_ID,
        catalog_id: this.config.CATALOG_ID,
        registration_version: resolvedVersion,
        object_count: products.length,
        batch_size: DEFAULT_SYNC_BATCH_SIZE,
        batch_count: batches.length,
        accepted_count: acceptedCount,
        rejected_count: rejectedCount,
        status: rejectedCount === 0 ? 'accepted' : acceptedCount > 0 ? 'partial' : 'rejected',
        batches,
      };
    });
  }

  async syncOne(productId: string, registrationVersion?: number) {
    const resolvedVersion = registrationVersion ?? await this.resolveActiveRegistrationVersion();
    const product = await this.products.getProduct(productId);
    const request = buildObjectSyncRequest(this.config, resolvedVersion, [product]);
    return this.recordRun('sync_one', resolvedVersion, productId, request, () => this.catalog.syncObjects(request));
  }

  async listSyncRuns() {
    return this.db
      .select()
      .from(schema.providerSyncRuns)
      .where(eq(schema.providerSyncRuns.providerId, this.config.COMMERCE_PROVIDER_ID))
      .orderBy(desc(schema.providerSyncRuns.createdAt));
  }

  private async findCatalogProviderState() {
    try {
      return await this.catalog.getProvider(this.config.COMMERCE_PROVIDER_ID);
    } catch (error) {
      if (error instanceof AppError && error.status === 404) return null;
      throw error;
    }
  }

  private async resolveNextRegistrationVersion() {
    const providerState = await this.findCatalogProviderState();
    return (providerState?.active_registration_version ?? 0) + 1;
  }

  private async resolveActiveRegistrationVersion() {
    const providerState = await this.findCatalogProviderState();
    if (!providerState?.active_registration_version) {
      throw new AppError('validation_error', 'Provider must be registered before syncing objects', 400);
    }
    return providerState.active_registration_version;
  }

  private async recordRun(
    runType: string,
    registrationVersion: number,
    targetProductId: string | null,
    request: Record<string, unknown>,
    fn: () => Promise<Record<string, unknown>>,
  ) {
    const runId = newId('psync');
    await this.db.insert(schema.providerSyncRuns).values({
      id: runId,
      providerId: this.config.COMMERCE_PROVIDER_ID,
      runType,
      targetProductId,
      registrationVersion,
      status: 'running',
      requestPayload: request,
    });

    try {
      const result = await fn();
      const [run] = await this.db
        .update(schema.providerSyncRuns)
        .set({
          status: 'succeeded',
          resultPayload: result,
          finishedAt: new Date(),
        })
        .where(eq(schema.providerSyncRuns.id, runId))
        .returning();
      return run;
    } catch (error) {
      const [run] = await this.db
        .update(schema.providerSyncRuns)
        .set({
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
          resultPayload: error instanceof Error && 'details' in error ? error.details as Record<string, unknown> : null,
          finishedAt: new Date(),
        })
        .where(eq(schema.providerSyncRuns.id, runId))
        .returning();
      return run;
    }
  }
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function summarizeProductQuality(products: Array<typeof schema.providerProducts.$inferSelect>) {
  const summary = {
    product_count: products.length,
    ready_for_publish_count: 0,
    missing_price_count: 0,
    missing_product_url_count: 0,
    missing_image_count: 0,
    missing_brand_or_category_count: 0,
    out_of_stock_count: 0,
    active_count: 0,
  };

  for (const product of products) {
    if (product.status === 'active') summary.active_count += 1;
    const hasPrice = Boolean(product.currency) && product.amount > 0;
    const hasUrl = Boolean(product.productUrl);
    const hasTaxonomy = Boolean(product.brand) && Boolean(product.category);
    if (product.status === 'active' && hasPrice && hasUrl && hasTaxonomy) summary.ready_for_publish_count += 1;
    if (!product.currency || product.amount <= 0) summary.missing_price_count += 1;
    if (!product.productUrl) summary.missing_product_url_count += 1;
    if (!product.imageUrls.length) summary.missing_image_count += 1;
    if (!product.brand || !product.category) summary.missing_brand_or_category_count += 1;
    if (product.availabilityStatus === 'out_of_stock') summary.out_of_stock_count += 1;
  }

  return summary;
}

function buildPublishReadiness(summary: ReturnType<typeof summarizeProductQuality>) {
  const blockingIssues: string[] = [];
  const warnings: string[] = [];

  if (summary.product_count === 0) {
    blockingIssues.push('No provider products exist yet.');
  }
  if (summary.active_count === 0) {
    blockingIssues.push('No active products are available for publish.');
  }
  if (summary.ready_for_publish_count === 0 && summary.active_count > 0) {
    blockingIssues.push('No active products meet the standard commerce publish baseline.');
  }
  if (summary.missing_image_count > 0) {
    warnings.push(`${summary.missing_image_count} product(s) are missing images.`);
  }
  if (summary.out_of_stock_count > 0) {
    warnings.push(`${summary.out_of_stock_count} product(s) are currently out of stock.`);
  }

  return {
    ready: blockingIssues.length === 0,
    blocking_issues: blockingIssues,
    warnings,
  };
}

export const __providerServiceTestOnly = {
  summarizeProductQuality,
  buildPublishReadiness,
};
