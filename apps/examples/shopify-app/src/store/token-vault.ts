import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { shopifyAppSchema as schema, type ShopifyAppDb as Db } from '@ocp-catalog/shopify-app-db';
import { eq } from 'drizzle-orm';
import type { ShopifyAppConfig } from '../config';

const ALGORITHM = 'aes-256-gcm';
const DEV_KEY_MATERIAL = 'shopify-app-dev-token-encryption-key';

export class TokenVault {
  private readonly key: Buffer;
  private readonly keyId: string;

  constructor(private readonly db: Db, cfg: ShopifyAppConfig) {
    const raw = cfg.SHOPIFY_APP_TOKEN_ENCRYPTION_KEY;
    this.key = raw ? parseConfiguredKey(raw) : createHash('sha256').update(DEV_KEY_MATERIAL).digest();
    this.keyId = raw ? `sha256:${createHash('sha256').update(this.key).digest('hex').slice(0, 16)}` : 'dev-local';
  }

  async store(shopDomain: string, accessToken: string): Promise<void> {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(accessToken, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const ciphertext = `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
    const tokenHash = createHash('sha256').update(accessToken).digest('hex');
    await this.db
      .insert(schema.shopifyAppTokens)
      .values({ shopDomain, accessTokenCiphertext: ciphertext, keyId: this.keyId, tokenHash, rotatedAt: new Date() })
      .onConflictDoUpdate({
        target: [schema.shopifyAppTokens.shopDomain],
        set: { accessTokenCiphertext: ciphertext, keyId: this.keyId, tokenHash, rotatedAt: new Date() },
      });
  }

  async load(shopDomain: string): Promise<string | null> {
    const [row] = await this.db
      .select()
      .from(schema.shopifyAppTokens)
      .where(eq(schema.shopifyAppTokens.shopDomain, shopDomain))
      .limit(1);
    if (!row) return null;
    return decrypt(row.accessTokenCiphertext, this.key);
  }

  async purge(shopDomain: string): Promise<void> {
    await this.db.delete(schema.shopifyAppTokens).where(eq(schema.shopifyAppTokens.shopDomain, shopDomain));
  }
}

function parseConfiguredKey(value: string): Buffer {
  const trimmed = value.trim();
  const prefixed = /^(base64|hex):(.+)$/i.exec(trimmed);
  if (prefixed) {
    const key = Buffer.from(prefixed[2], prefixed[1].toLowerCase() as BufferEncoding);
    if (key.length === 32) return key;
  }
  const direct = Buffer.from(trimmed, 'base64');
  if (direct.length === 32) return direct;
  const hex = Buffer.from(trimmed, 'hex');
  if (hex.length === 32) return hex;
  throw new Error('SHOPIFY_APP_TOKEN_ENCRYPTION_KEY must be a 32-byte base64 or hex key');
}

function decrypt(ciphertext: string, key: Buffer): string {
  const [version, iv64, tag64, encrypted64] = ciphertext.split(':');
  if (version !== 'v1' || !iv64 || !tag64 || !encrypted64) throw new Error('Unsupported token ciphertext format');
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv64, 'base64'));
  decipher.setAuthTag(Buffer.from(tag64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
