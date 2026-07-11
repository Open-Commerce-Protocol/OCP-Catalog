import { optionalEnv, parseBooleanEnv, parseIntegerEnv, requireEnv } from "./errors";

export type AppConfig = {
  catalogId: string;
  catalogName: string;
  publicBaseUrl: string;
  corsAllowedOrigins: string[];
  ingestApiKey: string;
  port: number;
  databaseUrl: string;
  dbSsl: boolean;
  openSearch: {
    node: string;
    username?: string;
    password?: string;
    index: string;
  };
  embedding: {
    baseUrl: string;
    apiKey?: string;
    model: string;
    dimension: number;
    enabled: boolean;
  };
  semanticEnabled: boolean;
  maxQueryLimit: number;
  defaultRecallLimit: number;
};

export function loadConfig(): AppConfig {
  const embeddingApiKey = optionalEnv("EMBEDDING_API_KEY");
  const openSearchUsername = optionalEnv("OPENSEARCH_USERNAME");
  const openSearchPassword = optionalEnv("OPENSEARCH_PASSWORD");
  const semanticEnabled = parseBooleanEnv("ENABLE_SEMANTIC", true);
  if (semanticEnabled && !embeddingApiKey) {
    throw new Error("EMBEDDING_API_KEY is required when ENABLE_SEMANTIC=true");
  }
  if (Boolean(openSearchUsername) !== Boolean(openSearchPassword)) {
    throw new Error("OPENSEARCH_USERNAME and OPENSEARCH_PASSWORD must both be set or both be empty");
  }
  const openSearch: AppConfig["openSearch"] = {
    node: requireEnv("OPENSEARCH_NODE"),
    index: requireEnv("OPENSEARCH_INDEX"),
  };
  if (openSearchUsername) openSearch.username = openSearchUsername;
  if (openSearchPassword) openSearch.password = openSearchPassword;
  const embedding: AppConfig["embedding"] = {
    baseUrl: requireEnv("EMBEDDING_BASE_URL").replace(/\/$/, ""),
    model: requireEnv("EMBEDDING_MODEL"),
    dimension: parseIntegerEnv("EMBEDDING_DIMENSION", 1536),
    enabled: Boolean(embeddingApiKey),
  };
  if (embeddingApiKey) embedding.apiKey = embeddingApiKey;
  return {
    catalogId: requireEnv("CATALOG_ID"),
    catalogName: process.env.CATALOG_NAME?.trim() || "OCP Domestic Jobs Matching Catalog",
    publicBaseUrl: requireEnv("CATALOG_PUBLIC_BASE_URL").replace(/\/$/, ""),
    corsAllowedOrigins: parseCorsAllowedOrigins(requireEnv("CORS_ALLOWED_ORIGINS")),
    ingestApiKey: requireEnv("INGEST_API_KEY"),
    port: parseIntegerEnv("PORT", 4400),
    databaseUrl: requireEnv("DATABASE_URL"),
    dbSsl: parseBooleanEnv("DB_SSL", true),
    openSearch,
    embedding,
    semanticEnabled,
    maxQueryLimit: parseIntegerEnv("MAX_QUERY_LIMIT", 50),
    defaultRecallLimit: parseIntegerEnv("DEFAULT_RECALL_LIMIT", 2000),
  };
}

function parseCorsAllowedOrigins(value: string) {
  const origins = value.split(",").map((origin) => origin.trim()).filter(Boolean);
  if (origins.length === 0) throw new Error("CORS_ALLOWED_ORIGINS must contain at least one origin");
  return origins.map((origin) => {
    const url = new URL(origin);
    const localHttp = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    if (url.origin !== origin || (url.protocol !== "https:" && !localHttp)) {
      throw new Error(`CORS_ALLOWED_ORIGINS contains invalid origin ${origin}`);
    }
    return origin;
  });
}
