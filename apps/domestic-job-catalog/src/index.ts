import { loadConfig } from "./config";
import { EmbeddingProvider } from "./embedding";
import { buildServer } from "./http/server";
import { IngestService } from "./ingest";
import { QueryService } from "./query";
import { ResolveService } from "./resolve";
import { createOpenSearchClient, JobSearchIndex } from "./search/opensearch";
import { createPool, JobRepository } from "./storage/postgres";

const config = loadConfig();
const pool = createPool(config);
const jobs = new JobRepository(pool, config.catalogId);
await jobs.ensureSchema();

const search = new JobSearchIndex(createOpenSearchClient(config), config.openSearch.index, config.embedding.dimension);
await search.ensureIndex();

const embeddings = new EmbeddingProvider(config.embedding);
const query = new QueryService(config, jobs, search, embeddings);
const resolve = new ResolveService(jobs, config.catalogId);
const ingest = new IngestService(jobs, search, embeddings, config.catalogId);

const app = await buildServer(config, { jobs, search, query, resolve, ingest });
await app.listen({ port: config.port, host: "0.0.0.0" });
