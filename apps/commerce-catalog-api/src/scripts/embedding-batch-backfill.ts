import { OpenAIEmbeddingBatchBackfillService } from '../search/indexing/openai-embedding-batch-backfill';
import { createCommerceCatalogWorkerRuntimeContext } from '../runtime/context';

type Command = 'submit' | 'poll' | 'ingest' | 'run';

const args = parseArgs(process.argv.slice(2));
const command = (args.command ?? 'run') as Command;
const context = createCommerceCatalogWorkerRuntimeContext();
const service = new OpenAIEmbeddingBatchBackfillService(
  context.db,
  context.config,
  context.searchEmbeddingService,
);

try {
  const result = await run(command);
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
} catch (error) {
  console.error(JSON.stringify({
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exit(1);
}

async function run(currentCommand: Command) {
  switch (currentCommand) {
    case 'submit':
      return service.submit({
        limit: parseInteger(args.limit),
        providerId: args.provider,
        dryRun: args.dryRun === 'true',
      });
    case 'poll':
      return service.poll({ jobId: args.job });
    case 'ingest':
      return service.ingest({
        jobId: args.job,
        limit: parseInteger(args.limit),
      });
    case 'run': {
      const submitted = await service.submit({
        limit: parseInteger(args.limit),
        providerId: args.provider,
        dryRun: args.dryRun === 'true',
      });
      const polled = await service.poll();
      const ingested = await service.ingest();
      return { submitted, polled, ingested };
    }
    default:
      throw new Error(`Unknown embedding batch backfill command: ${currentCommand}`);
  }
}

function parseArgs(input: string[]) {
  const parsed: Record<string, string> = {};
  for (const item of input) {
    if (!item.startsWith('--')) {
      if (!parsed.command) parsed.command = item;
      continue;
    }
    const [key, value] = item.slice(2).split('=', 2);
    parsed[toCamelCase(key ?? '')] = value ?? 'true';
  }
  return parsed;
}

function parseInteger(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, got ${value}`);
  }
  return parsed;
}

function toCamelCase(value: string) {
  return value.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}
