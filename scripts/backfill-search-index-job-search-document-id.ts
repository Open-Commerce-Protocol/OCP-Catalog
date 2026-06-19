const args = parseArgs(process.argv.slice(2));
const databaseUrl = args.databaseUrl ?? process.env.DATABASE_URL ?? readDotEnvValue('DATABASE_URL');
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required. Pass --database-url or set DATABASE_URL.');
}

const batchSize = parsePositiveInteger(args.batchSize ?? '5000', '--batch-size');
const maxBatches = parsePositiveInteger(args.maxBatches ?? '100', '--max-batches');
const statementTimeout = parseTimeout(args.statementTimeout ?? '5s', '--statement-timeout');
const lockTimeout = parseTimeout(args.lockTimeout ?? '500ms', '--lock-timeout');
const batchDelayMs = parseNonNegativeInteger(args.batchDelayMs ?? '0', '--batch-delay-ms');
const dryRun = args.dryRun === 'true';

try {
  const result = await run();
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    level: 'info',
    event: 'search_index_job_search_document_id_backfill_done',
    ...result,
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ts: new Date().toISOString(),
    level: 'error',
    event: 'search_index_job_search_document_id_backfill_failed',
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
}

async function run() {
  let totalUpdated = 0;
  for (let batch = 1; batch <= maxBatches; batch += 1) {
    const updated = dryRun ? countCandidateBatch() : backfillBatch();
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      level: 'info',
      event: 'search_index_job_search_document_id_backfill_batch',
      batch,
      batch_size: batchSize,
      statement_timeout: statementTimeout,
      lock_timeout: lockTimeout,
      batch_delay_ms: batchDelayMs,
      updated_count: updated,
      dry_run: dryRun,
    }));
    totalUpdated += updated;
    if (updated === 0 || dryRun) {
      return { batches: batch, updated_count: totalUpdated, dry_run: dryRun };
    }
    if (batchDelayMs > 0 && batch < maxBatches) {
      await Bun.sleep(batchDelayMs);
    }
  }
  return { batches: maxBatches, updated_count: totalUpdated, dry_run: dryRun };
}

function backfillBatch() {
  return runScalarSql(`
    BEGIN;
    SET LOCAL statement_timeout = '${statementTimeout}';
    SET LOCAL lock_timeout = '${lockTimeout}';
    WITH rows AS (
      SELECT id, payload->>'search_document_id' AS search_document_id
      FROM catalog_search_index_jobs
      WHERE job_type = 'refresh_embedding'
        AND status IN ('pending', 'running')
        AND search_document_id IS NULL
        AND payload->>'search_document_id' IS NOT NULL
      ORDER BY id
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    ),
    updated AS (
      UPDATE catalog_search_index_jobs jobs
      SET
        search_document_id = rows.search_document_id,
        updated_at = now()
      FROM rows
      WHERE jobs.id = rows.id
      RETURNING jobs.id
    )
    SELECT count(*)::int FROM updated;
    COMMIT;
  `);
}

function countCandidateBatch() {
  return runScalarSql(`
    SELECT count(*)::int
    FROM (
      SELECT 1
      FROM catalog_search_index_jobs
      WHERE job_type = 'refresh_embedding'
        AND status IN ('pending', 'running')
        AND search_document_id IS NULL
        AND payload->>'search_document_id' IS NOT NULL
      ORDER BY id
      LIMIT ${batchSize}
    ) candidates;
  `);
}

function runScalarSql(statement: string) {
  const result = Bun.spawnSync({
    cmd: ['psql', databaseUrl, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At', '-c', statement],
    stdout: 'pipe',
    stderr: 'pipe',
    env: process.env,
  });
  const stdout = new TextDecoder().decode(result.stdout).trim();
  const stderr = new TextDecoder().decode(result.stderr).trim();
  if (!result.success) {
    throw new Error(stderr || `psql exited with code ${result.exitCode}`);
  }
  const value = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected psql to return a non-negative integer, got ${JSON.stringify(stdout)}`);
  }
  return parsed;
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

function parsePositiveInteger(value: string, name: string) {
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

function toCamelCase(value: string) {
  return value.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}
