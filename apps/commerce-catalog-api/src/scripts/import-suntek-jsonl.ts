import { importSuntekJsonl, parseSuntekImportOptions } from './suntek-jsonl-importer';

try {
  const options = parseSuntekImportOptions(process.argv.slice(2));
  const result = await importSuntekJsonl(options);
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
} catch (error) {
  console.error(JSON.stringify({
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exit(1);
}
