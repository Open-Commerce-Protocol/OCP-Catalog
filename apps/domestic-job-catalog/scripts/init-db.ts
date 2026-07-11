import { loadConfig } from "../src/config";
import { createPool, JobRepository } from "../src/storage/postgres";

const config = loadConfig();
const pool = createPool(config);
const jobs = new JobRepository(pool, config.catalogId);
await jobs.ensureSchema();
await pool.end();
console.log(`Initialized database schema for ${config.catalogId}`);
