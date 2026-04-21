import { defineConfig } from 'drizzle-kit';
import { loadConfig } from '@ocp-catalog/config';

const config = loadConfig();

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: config.DATABASE_URL,
  },
});
