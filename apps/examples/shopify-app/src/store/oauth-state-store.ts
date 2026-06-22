import { createHash } from 'node:crypto';
import { shopifyAppSchema as schema, type ShopifyAppDb as Db } from '@ocp-catalog/shopify-app-db';
import { and, eq, gt, isNull } from 'drizzle-orm';

const STATE_TTL_MS = 10 * 60 * 1000;

export class OAuthStateStore {
  constructor(private readonly db: Db) {}

  async create(shopDomain: string): Promise<string> {
    const state = crypto.randomUUID();
    await this.db.insert(schema.shopifyAppOAuthStates).values({
      state: hashState(state),
      shopDomain,
      expiresAt: new Date(Date.now() + STATE_TTL_MS),
    });
    return state;
  }

  async consume(input: { state: string; shopDomain: string; now?: Date }): Promise<boolean> {
    const now = input.now ?? new Date();
    const [row] = await this.db
      .update(schema.shopifyAppOAuthStates)
      .set({ consumedAt: now })
      .where(and(
        eq(schema.shopifyAppOAuthStates.state, hashState(input.state)),
        eq(schema.shopifyAppOAuthStates.shopDomain, input.shopDomain),
        isNull(schema.shopifyAppOAuthStates.consumedAt),
        gt(schema.shopifyAppOAuthStates.expiresAt, now),
      ))
      .returning();
    return Boolean(row);
  }
}

function hashState(state: string): string {
  return createHash('sha256').update(state).digest('hex');
}
