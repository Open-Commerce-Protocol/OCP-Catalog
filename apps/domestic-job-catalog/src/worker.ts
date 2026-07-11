import { loadConfig } from "./config";
import { createOpenSearchClient, JobSearchIndex } from "./search/opensearch";
import { createPool, JobRepository } from "./storage/postgres";

const config = loadConfig();
const pool = createPool(config);
const jobs = new JobRepository(pool, config.catalogId);
await jobs.ensureSchema();
const search = new JobSearchIndex(createOpenSearchClient(config), config.openSearch.index, config.embedding.dimension);
await search.ensureIndex();

console.log(JSON.stringify({
  ts: new Date().toISOString(),
  event: "domestic_job_catalog_worker_ready",
  catalog_id: config.catalogId,
  opensearch_index: config.openSearch.index,
}));

setInterval(() => {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    event: "domestic_job_catalog_worker_heartbeat",
    catalog_id: config.catalogId,
  }));
}, 60_000);
