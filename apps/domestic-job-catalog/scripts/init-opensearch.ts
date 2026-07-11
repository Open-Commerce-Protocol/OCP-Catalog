import { loadConfig } from "../src/config";
import { createOpenSearchClient, JobSearchIndex } from "../src/search/opensearch";

const config = loadConfig();
const search = new JobSearchIndex(createOpenSearchClient(config), config.openSearch.index, config.embedding.dimension);
await search.ensureIndex();
console.log(`Initialized OpenSearch index ${config.openSearch.index}`);
