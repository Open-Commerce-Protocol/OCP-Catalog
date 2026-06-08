import Redis from 'ioredis';

export type CachedQueryEmbedding = {
  vector: number[];
  model: string;
  dimension: number;
};

export interface QueryEmbeddingCache {
  get(key: string): Promise<CachedQueryEmbedding | null>;
  set(key: string, value: CachedQueryEmbedding): Promise<void>;
  close?(): Promise<void>;
}

export class InMemoryQueryEmbeddingCache implements QueryEmbeddingCache {
  private readonly entries = new Map<string, CachedQueryEmbedding & { expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
  ) {}

  async get(key: string) {
    const now = Date.now();
    const cached = this.entries.get(key);
    if (!cached) return null;
    if (cached.expiresAt <= now) {
      this.entries.delete(key);
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, cached);
    return {
      vector: cached.vector,
      model: cached.model,
      dimension: cached.dimension,
    };
  }

  async set(key: string, value: CachedQueryEmbedding) {
    this.entries.set(key, {
      ...value,
      expiresAt: Date.now() + this.ttlMs,
    });
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (!oldestKey) break;
      this.entries.delete(oldestKey);
    }
  }
}

export class RedisQueryEmbeddingCache implements QueryEmbeddingCache {
  private readonly redis: Redis;

  constructor(
    redisUrl: string,
    private readonly ttlSeconds: number,
  ) {
    this.redis = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
  }

  async get(key: string) {
    await this.connect();
    const raw = await this.redis.get(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedQueryEmbedding;
    if (!isValidCachedQueryEmbedding(parsed)) {
      throw new Error(`Invalid query embedding cache payload for ${key}`);
    }
    return parsed;
  }

  async set(key: string, value: CachedQueryEmbedding) {
    await this.connect();
    await this.redis.set(key, JSON.stringify(value), 'EX', this.ttlSeconds);
  }

  async close() {
    this.redis.disconnect();
  }

  private async connect() {
    if (this.redis.status === 'ready') return;
    await this.redis.connect();
  }
}

function isValidCachedQueryEmbedding(value: unknown): value is CachedQueryEmbedding {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record.vector)
    && record.vector.every((item) => typeof item === 'number' && Number.isFinite(item))
    && typeof record.model === 'string'
    && typeof record.dimension === 'number'
    && Number.isInteger(record.dimension);
}
