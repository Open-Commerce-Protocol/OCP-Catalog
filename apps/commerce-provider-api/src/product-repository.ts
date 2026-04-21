import type { AppConfig } from '@ocp-catalog/config';
import type { Db } from '@ocp-catalog/db';
import { schema } from '@ocp-catalog/db';
import { AppError, newId } from '@ocp-catalog/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { ProductCreateInput, ProductPatchInput } from './product-schema';

export class ProductRepository {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
  ) {}

  async listProducts() {
    return this.db
      .select()
      .from(schema.providerProducts)
      .where(eq(schema.providerProducts.providerId, this.config.COMMERCE_PROVIDER_ID))
      .orderBy(desc(schema.providerProducts.updatedAt));
  }

  async getProduct(id: string) {
    const [product] = await this.db
      .select()
      .from(schema.providerProducts)
      .where(and(
        eq(schema.providerProducts.providerId, this.config.COMMERCE_PROVIDER_ID),
        eq(schema.providerProducts.id, id),
      ))
      .limit(1);

    if (!product) throw new AppError('not_found', `Product ${id} was not found`, 404);
    return product;
  }

  async createProduct(input: ProductCreateInput) {
    const productUrl = input.product_url ?? `${this.config.PROVIDER_PUBLIC_BASE_URL.replace(/\/$/, '')}/products/${input.sku}`;
    const [product] = await this.db
      .insert(schema.providerProducts)
      .values({
        id: newId('pprod'),
        providerId: this.config.COMMERCE_PROVIDER_ID,
        sku: input.sku,
        title: input.title,
        summary: input.summary,
        brand: input.brand,
        category: input.category,
        productUrl,
        imageUrls: input.image_urls,
        currency: input.currency,
        amount: toCents(input.amount),
        availabilityStatus: input.availability_status,
        quantity: input.quantity,
        status: input.status,
        attributes: input.attributes,
      })
      .returning();

    if (!product) throw new AppError('internal_error', 'Failed to create product', 500);
    return product;
  }

  async updateProduct(id: string, input: ProductPatchInput) {
    await this.getProduct(id);
    const [product] = await this.db
      .update(schema.providerProducts)
      .set({
        ...(input.sku ? { sku: input.sku } : {}),
        ...(input.title ? { title: input.title } : {}),
        ...(input.summary ? { summary: input.summary } : {}),
        ...(input.brand ? { brand: input.brand } : {}),
        ...(input.category ? { category: input.category } : {}),
        ...(input.product_url ? { productUrl: input.product_url } : {}),
        ...(input.image_urls ? { imageUrls: input.image_urls } : {}),
        ...(input.currency ? { currency: input.currency } : {}),
        ...(input.amount !== undefined ? { amount: toCents(input.amount) } : {}),
        ...(input.availability_status ? { availabilityStatus: input.availability_status } : {}),
        ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.attributes ? { attributes: input.attributes } : {}),
        updatedAt: new Date(),
      })
      .where(and(
        eq(schema.providerProducts.providerId, this.config.COMMERCE_PROVIDER_ID),
        eq(schema.providerProducts.id, id),
      ))
      .returning();

    if (!product) throw new AppError('internal_error', 'Failed to update product', 500);
    return product;
  }

  async deactivateProduct(id: string) {
    return this.updateProduct(id, {
      status: 'inactive',
      availability_status: 'out_of_stock',
      quantity: 0,
    });
  }

  async seedDemoProducts(products: ProductCreateInput[]) {
    const rows = [];
    for (const input of products) {
      const [existing] = await this.db
        .select()
        .from(schema.providerProducts)
        .where(and(
          eq(schema.providerProducts.providerId, this.config.COMMERCE_PROVIDER_ID),
          eq(schema.providerProducts.sku, input.sku),
        ))
        .limit(1);

      rows.push(existing ? await this.updateProduct(existing.id, input) : await this.createProduct(input));
    }
    return rows;
  }
}

function toCents(amount: number) {
  return Math.round(amount * 100);
}
