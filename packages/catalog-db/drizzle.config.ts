import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  migrations: {
    schema: 'drizzle',
    table: '__drizzle_migrations_catalog',
  },
});
