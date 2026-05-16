import postgres from 'postgres';
import { loadConfig } from '@ocp-catalog/config';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const SYSTEM_DATABASES = new Set(['postgres', 'template0', 'template1']);

const config = loadConfig();
const databaseUrl = new URL(config.DATABASE_URL);
const databaseName = databaseUrl.pathname.replace(/^\//, '');

if (!LOCAL_HOSTS.has(databaseUrl.hostname) && process.env.DB_RESET_ALLOW_NON_LOCAL !== '1') {
  throw new Error(
    `Refusing to reset non-local database host "${databaseUrl.hostname}". ` +
      'Set DB_RESET_ALLOW_NON_LOCAL=1 only for an intentional disposable environment.',
  );
}

if (!databaseName || SYSTEM_DATABASES.has(databaseName)) {
  throw new Error(`Refusing to reset system database "${databaseName}".`);
}

const sql = postgres(config.DATABASE_URL, { max: 1 });

try {
  console.log(`Resetting database "${databaseName}" on ${databaseUrl.host}`);

  await sql`DROP EXTENSION IF EXISTS vector CASCADE`;
  await sql`DROP EXTENSION IF EXISTS pg_trgm CASCADE`;
  await sql`DROP SCHEMA IF EXISTS drizzle CASCADE`;
  await sql`DROP SCHEMA IF EXISTS public CASCADE`;
  await sql`CREATE SCHEMA public`;
  await sql`GRANT ALL ON SCHEMA public TO PUBLIC`;

  console.log('Database schema reset complete. Run migrations next.');
} finally {
  await sql.end();
}
