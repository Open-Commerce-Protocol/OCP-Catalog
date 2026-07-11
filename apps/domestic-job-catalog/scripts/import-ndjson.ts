import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface } from "node:readline";

const args = parseArgs(process.argv.slice(2));
const inputPath = requireArg(args, "input");
const port = Number(requireArg(args, "port"));
const shardIndex = Number(requireArg(args, "shard-index"));
const shardCount = Number(requireArg(args, "shard-count"));
const batchSize = Number(args["batch-size"] ?? "100");
const checkpointPath = requireArg(args, "checkpoint");
const ingestApiKey = requireEnv("INGEST_API_KEY");
for (const [name, value, min] of [["port", port, 1], ["shard-index", shardIndex, 0], ["shard-count", shardCount, 1], ["batch-size", batchSize, 1]] as const) {
  if (!Number.isInteger(value) || value < min) throw new Error(`--${name} must be an integer >= ${min}`);
}
if (shardIndex >= shardCount) throw new Error("--shard-index must be smaller than --shard-count");

type Checkpoint = { next_batch: number; accepted_objects: number; updated_at: string };
const checkpoint = await loadCheckpoint(checkpointPath);
let batchNumber = 0;
let acceptedObjects = checkpoint.accepted_objects;
let lines = 0;
let batch: unknown[] = [];

for await (const line of readLines(inputPath)) {
  const lineIndex = lines++;
  if (lineIndex % shardCount !== shardIndex) continue;
  batch.push(JSON.parse(line));
  if (batch.length >= batchSize) {
    acceptedObjects = await importBatch(batch, batchNumber++, checkpoint, acceptedObjects);
    batch = [];
  }
}
if (batch.length > 0) acceptedObjects = await importBatch(batch, batchNumber++, checkpoint, acceptedObjects);
console.log(JSON.stringify({ event: "import_complete", input: inputPath, port, shard_index: shardIndex, shard_count: shardCount, batches_seen: batchNumber, accepted_objects: acceptedObjects }));

async function importBatch(objects: unknown[], currentBatch: number, state: Checkpoint, accepted: number) {
  if (currentBatch < state.next_batch) return accepted;
  const response = await fetch(`http://127.0.0.1:${port}/ocp/objects/sync`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": ingestApiKey },
    body: JSON.stringify({ ocp_version: "1.0", kind: "ObjectSyncRequest", catalog_id: "cat_ocp_domestic_jobs_prod", objects }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`batch ${currentBatch} failed with HTTP ${response.status}: ${body.slice(0, 16000)}`);
  const result = JSON.parse(body) as { accepted_count?: unknown; failed_count?: unknown };
  if (result.accepted_count !== objects.length || result.failed_count !== 0) {
    throw new Error(`batch ${currentBatch} returned an invalid acceptance result: ${body.slice(0, 16000)}`);
  }
  const next: Checkpoint = { next_batch: currentBatch + 1, accepted_objects: accepted + objects.length, updated_at: new Date().toISOString() };
  await writeCheckpoint(checkpointPath, next);
  state.next_batch = next.next_batch;
  state.accepted_objects = next.accepted_objects;
  console.log(JSON.stringify({ event: "batch_imported", port, shard_index: shardIndex, batch: currentBatch, accepted_objects: next.accepted_objects }));
  return next.accepted_objects;
}

async function loadCheckpoint(path: string): Promise<Checkpoint> {
  if (!existsSync(path)) return { next_batch: 0, accepted_objects: 0, updated_at: new Date(0).toISOString() };
  const value = JSON.parse(await readFile(path, "utf8")) as Checkpoint;
  if (!Number.isInteger(value.next_batch) || value.next_batch < 0 || !Number.isInteger(value.accepted_objects) || value.accepted_objects < 0) throw new Error(`Invalid checkpoint ${path}`);
  return value;
}
async function writeCheckpoint(path: string, value: Checkpoint) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, "utf8");
  await rename(temporary, path);
}
async function* readLines(path: string) { const lines = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity }); for await (const line of lines) { if (line.trim()) yield line; } }
function parseArgs(values: string[]) { const result: Record<string, string> = {}; for (let i = 0; i < values.length; i += 2) { const key = values[i]; const value = values[i + 1]; if (!key?.startsWith("--") || !value) throw new Error("Arguments must use --name value pairs."); result[key.slice(2)] = value; } return result; }
function requireArg(values: Record<string, string>, name: string) { const value = values[name]; if (!value) throw new Error(`Missing --${name}`); return value; }
function requireEnv(name: string) { const value = process.env[name]?.trim(); if (!value) throw new Error(`Missing required environment variable ${name}`); return value; }
