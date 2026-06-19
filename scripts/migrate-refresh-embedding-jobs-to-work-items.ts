const args = parseArgs(process.argv.slice(2));
const databaseUrl = args.databaseUrl ?? process.env.DATABASE_URL ?? readDotEnvValue('DATABASE_URL');
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required. Pass --database-url or set DATABASE_URL.');
}

const catalogId = requiredArg(args.catalogId ?? process.env.CATALOG_ID ?? readDotEnvValue('CATALOG_ID'), 'catalog id');
const embeddingProvider = requiredArg(args.embeddingProvider ?? process.env.EMBEDDING_PROVIDER ?? 'openai', 'embedding provider');
const embeddingModel = requiredArg(args.embeddingModel ?? process.env.EMBEDDING_MODEL ?? readDotEnvValue('EMBEDDING_MODEL'), 'embedding model');
const embeddingDimension = parsePositiveInteger(
  args.embeddingDimension ?? process.env.EMBEDDING_DIMENSION ?? readDotEnvValue('EMBEDDING_DIMENSION'),
  '--embedding-dimension',
);
const batchSize = parsePositiveInteger(args.batchSize ?? '1000', '--batch-size');
const maxBatches = parsePositiveInteger(args.maxBatches ?? '100', '--max-batches');
const statementTimeout = parseTimeout(args.statementTimeout ?? '30s', '--statement-timeout');
const lockTimeout = parseTimeout(args.lockTimeout ?? '500ms', '--lock-timeout');
const mode = parseMode(args.mode ?? 'payload-null-column');
const batchDelayMs = parseNonNegativeInteger(args.batchDelayMs ?? '0', '--batch-delay-ms');

try {
  const result = await run();
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    level: 'info',
    event: 'refresh_embedding_jobs_to_work_items_migration_done',
    ...result,
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ts: new Date().toISOString(),
    level: 'error',
    event: 'refresh_embedding_jobs_to_work_items_migration_failed',
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
}

async function run() {
  let totalMigrated = 0;
  let totalCancelled = 0;
  for (let batch = 1; batch <= maxBatches; batch += 1) {
    const result = migrateBatch();
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      level: 'info',
      event: 'refresh_embedding_jobs_to_work_items_migration_batch',
      batch,
      batch_size: batchSize,
      mode,
      batch_delay_ms: batchDelayMs,
      migrated_count: result.migratedCount,
      cancelled_count: result.cancelledCount,
    }));
    totalMigrated += result.migratedCount;
    totalCancelled += result.cancelledCount;
    if (result.cancelledCount === 0) {
      return { batches: batch, migrated_count: totalMigrated, cancelled_count: totalCancelled };
    }
    if (batchDelayMs > 0 && batch < maxBatches) {
      await Bun.sleep(batchDelayMs);
    }
  }
  return { batches: maxBatches, migrated_count: totalMigrated, cancelled_count: totalCancelled };
}

function migrateBatch() {
  const documentExpression = mode === 'payload-null-column'
    ? "payload->>'search_document_id'"
    : 'search_document_id';
  const documentPredicate = mode === 'payload-null-column'
    ? "search_document_id IS NULL AND payload->>'search_document_id' IS NOT NULL"
    : 'search_document_id IS NOT NULL';
  const rows = runRowsSql(`
    BEGIN;
    SET LOCAL statement_timeout = '${statementTimeout}';
    SET LOCAL lock_timeout = '${lockTimeout}';
    WITH candidate_jobs AS (
      SELECT
        id,
        provider_id,
        ${documentExpression} AS document_id
      FROM catalog_search_index_jobs
      WHERE catalog_id = '${sqlLiteral(catalogId)}'
        AND job_type = 'refresh_embedding'
        AND status IN ('pending', 'running')
        AND ${documentPredicate}
      ORDER BY id
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    ),
    inserted_work_items AS (
      INSERT INTO catalog_embedding_work_items (
        id,
        catalog_id,
        provider_id,
        catalog_search_document_id,
        embedding_provider,
        embedding_model,
        embedding_dimension,
        status,
        reason,
        source_search_index_job_id,
        created_at,
        updated_at
      )
      SELECT
        'embmig_' || candidate_jobs.id,
        '${sqlLiteral(catalogId)}',
        candidate_jobs.provider_id,
        candidate_jobs.document_id,
        '${sqlLiteral(embeddingProvider)}',
        '${sqlLiteral(embeddingModel)}',
        ${embeddingDimension},
        'pending',
        'migrated_refresh_embedding_job',
        candidate_jobs.id,
        now(),
        now()
      FROM candidate_jobs
      ON CONFLICT (catalog_id, catalog_search_document_id, embedding_model)
      DO UPDATE SET
        status = 'pending',
        reason = 'migrated_refresh_embedding_job',
        provider_id = excluded.provider_id,
        source_search_index_job_id = excluded.source_search_index_job_id,
        embedding_batch_job_id = null,
        submitted_at = null,
        completed_at = null,
        error = null,
        updated_at = now()
      WHERE catalog_embedding_work_items.status <> 'submitted'
      RETURNING id
    ),
    cancelled_jobs AS (
      UPDATE catalog_search_index_jobs jobs
      SET
        status = 'cancelled',
        finished_at = now(),
        updated_at = now()
      FROM candidate_jobs
      WHERE jobs.id = candidate_jobs.id
      RETURNING jobs.id
    )
    SELECT
      (SELECT count(*)::int FROM inserted_work_items) AS migrated_count,
      (SELECT count(*)::int FROM cancelled_jobs) AS cancelled_count;
    COMMIT;
  `);
  const [line] = rows;
  if (!line) throw new Error('Expected migration batch to return counts');
  const [migratedCount, cancelledCount] = line.split('|').map((value) => Number(value));
  if (!Number.isInteger(migratedCount) || !Number.isInteger(cancelledCount)) {
    throw new Error(`Expected integer counts, got ${JSON.stringify(line)}`);
  }
  return { migratedCount, cancelledCount };
}

function runRowsSql(statement: string) {
  const connectionEnv = parsePostgresUrl(databaseUrl);
  const result = Bun.spawnSync({
    cmd: ['psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At', '-F', '|', '-c', statement],
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      ...connectionEnv,
    },
  });
  const stdout = new TextDecoder().decode(result.stdout).trim();
  const stderr = new TextDecoder().decode(result.stderr).trim();
  if (!result.success) {
    throw new Error(stderr || `psql exited with code ${result.exitCode}`);
  }
  return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function parsePostgresUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must use postgres:// or postgresql://');
  }
  return {
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGDATABASE: url.pathname.replace(/^\//, '') || 'postgres',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: url.searchParams.get('sslmode') ?? 'require',
  };
}

function parseArgs(input: string[]) {
  const parsed: Record<string, string> = {};
  for (const item of input) {
    if (!item.startsWith('--')) {
      throw new Error(`Unexpected positional argument: ${item}`);
    }
    const [key, value] = item.slice(2).split('=', 2);
    parsed[toCamelCase(key ?? '')] = value ?? 'true';
  }
  return parsed;
}

function requiredArg(value: string | undefined, name: string) {
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function parsePositiveInteger(value: string | undefined, name: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeInteger(value: string, name: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function parseTimeout(value: string, name: string) {
  if (!/^[1-9]\d*(ms|s|min)$/.test(value)) {
    throw new Error(`${name} must use a positive duration with ms, s, or min suffix`);
  }
  return value;
}

function parseMode(value: string) {
  if (value === 'payload-null-column' || value === 'materialized-column') {
    return value;
  }
  throw new Error('--mode must be payload-null-column or materialized-column');
}

function readDotEnvValue(key: string) {
  const file = Bun.file('.env');
  if (!file.size) return undefined;
  const text = file.textSync();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.startsWith(`${key}=`)) continue;
    let value = trimmed.slice(key.length + 1).trim();
    if (value.length >= 2 && value[0] === value.at(-1) && (value[0] === '"' || value[0] === "'")) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return undefined;
}

function sqlLiteral(value: string) {
  return value.replace(/'/g, "''");
}

function toCamelCase(value: string) {
  return value.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}
