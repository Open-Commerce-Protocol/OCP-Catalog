import { z } from 'zod';

export const envSchema = z.object({
  DATABASE_URL: z.string().default('postgres://ocp:ocp@localhost:5432/ocp_catalog'),
  CATALOG_API_PORT: z.coerce.number().default(4000),
  CATALOG_PUBLIC_BASE_URL: z.string().url().default('http://localhost:4000'),
  PROVIDER_API_PORT: z.coerce.number().default(4200),
  PROVIDER_PUBLIC_BASE_URL: z.string().url().default('http://localhost:4200'),
  USER_DEMO_API_PORT: z.coerce.number().default(4230),
  PROTOCOL_DOCS_PORT: z.coerce.number().default(5173),
  REGISTRATION_API_PORT: z.coerce.number().default(4100),
  REGISTRATION_ADMIN_UI_PORT: z.coerce.number().default(4250),
  REGISTRATION_PUBLIC_BASE_URL: z.string().url().default('https://ocp.deeplumen.io'),
  REGISTRATION_DISCOVERY_URL: z.string().url().default('https://ocp.deeplumen.io/.well-known/ocp-center'),
  REGISTRATION_REFRESH_SCHEDULER_ENABLED: z.coerce.boolean().default(true),
  REGISTRATION_REFRESH_INTERVAL_SECONDS: z.coerce.number().int().min(30).default(300),
  CATALOG_SEARCH_INDEX_WORKER_ENABLED: z.coerce.boolean().default(true),
  CATALOG_SEARCH_INDEX_WORKER_INTERVAL_SECONDS: z.coerce.number().int().min(5).default(30),
  CATALOG_SEARCH_INDEX_WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(200).default(25),
  CATALOG_SEARCH_INDEX_RECONCILE_ON_STARTUP: z.coerce.boolean().default(true),
  API_KEY_DEV: z.string().default('dev-api-key'),
  API_KEYS: z.string().default(''),
  CATALOG_ID: z.string().default('cat_local_dev'),
  CATALOG_NAME: z.string().default('Local OCP Catalog'),
  COMMERCE_PROVIDER_ID: z.string().default('commerce_provider_local_dev'),
  COMMERCE_PROVIDER_NAME: z.string().default('Local Commerce Provider'),
  COMMERCE_PROVIDER_CONTACT_EMAIL: z.string().email().default('ops@example.test'),
  COMMERCE_PROVIDER_DOMAIN: z.string().default('localhost'),
  REGISTRATION_ID: z.string().default('registration_local_dev'),
  REGISTRATION_NAME: z.string().default('Local OCP Catalog Registration Node'),
  EMBEDDING_MODEL: z.string().default('local-hash-v1'),
  EMBEDDING_DIMENSION: z.coerce.number().int().min(1).default(64),
  USER_DEMO_AGENT_MODEL: z.string().default('qwen-plus'),
  OPENAI_API_KEY: z.string().default(''),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
});

export type AppConfig = z.infer<typeof envSchema>;

