import type { AppConfig } from '@ocp-catalog/config';
import type { EmbeddingProvider, EmbeddingResult } from './search/indexing/search-embedding-service';
import { createHash } from 'node:crypto';

export function createCommerceEmbeddingProvider(config: AppConfig): EmbeddingProvider {
  if (!config.OPENAI_API_KEY) {
    return new LocalHashEmbeddingProvider(config.EMBEDDING_MODEL, config.EMBEDDING_DIMENSION);
  }

  const model = config.EMBEDDING_MODEL === 'local-hash-v1'
    ? 'text-embedding-3-small'
    : config.EMBEDDING_MODEL;

  return new OpenAIEmbeddingProvider({
    apiKey: config.OPENAI_API_KEY,
    baseUrl: config.OPENAI_BASE_URL,
    model,
    dimension: config.EMBEDDING_DIMENSION,
    timeoutMs: config.OPENAI_TIMEOUT_MS,
    maxInputChars: config.OPENAI_EMBEDDING_MAX_INPUT_CHARS,
  });
}

class LocalHashEmbeddingProvider implements EmbeddingProvider {
  readonly providerId = 'local';

  constructor(
    readonly model: string,
    readonly dimension: number,
  ) {}

  async embed(input: string): Promise<EmbeddingResult> {
    const vector = Array.from({ length: this.dimension }, () => 0);
    for (const token of tokenize(input)) {
      const hash = createHash('sha256').update(token).digest();
      for (let index = 0; index < hash.length; index += 2) {
        const bucket = hash[index]! % this.dimension;
        const sign = hash[index + 1]! % 2 === 0 ? 1 : -1;
        vector[bucket] += sign;
      }
    }

    return {
      vector: normalize(vector),
      model: this.model,
      dimension: this.dimension,
    };
  }
}

class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly providerId = 'openai';
  readonly model: string;
  readonly dimension: number;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxInputChars: number;

  constructor(options: {
    apiKey: string;
    baseUrl: string;
    model: string;
    dimension: number;
    timeoutMs: number;
    maxInputChars: number;
  }) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.model = options.model;
    this.dimension = options.dimension;
    this.timeoutMs = options.timeoutMs;
    this.maxInputChars = options.maxInputChars;
  }

  async embed(input: string): Promise<EmbeddingResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const body: Record<string, unknown> = {
      model: this.model,
      input: truncateInput(input, this.maxInputChars),
    };
    if (this.model.startsWith('text-embedding-3-') && Number.isInteger(this.dimension) && this.dimension > 0) {
      body.dimensions = this.dimension;
    }

    try {
      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(`Embedding request failed: ${response.status} ${response.statusText} ${message}`);
      }

      const payload = await response.json();
      const vector = payload?.data?.[0]?.embedding;
      if (!Array.isArray(vector) || !vector.every((value) => typeof value === 'number')) {
        throw new Error('Embedding response did not include a numeric vector');
      }

      return {
        vector,
        model: this.model,
        dimension: vector.length,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function truncateInput(input: string, maxInputChars: number) {
  if (input.length <= maxInputChars) return input;
  return input.slice(0, maxInputChars);
}

function tokenize(input: string) {
  return input.toLowerCase().split(/[\s,;:/|()[\]{}"'`~!?.]+/).map((token) => token.trim()).filter(Boolean);
}

function normalize(vector: number[]) {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) return vector;
  return vector.map((value) => Number((value / magnitude).toFixed(6)));
}
