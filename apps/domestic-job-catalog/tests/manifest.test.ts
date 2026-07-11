import { describe, expect, test } from "bun:test";
import { buildManifest } from "../src/manifest";
import type { AppConfig } from "../src/config";

const config: AppConfig = {
  catalogId: "cat_ocp_domestic_jobs_prod",
  catalogName: "Domestic Jobs",
  publicBaseUrl: "https://domesticjobs.catalog.pageflux.net",
  corsAllowedOrigins: ["https://ocp.deeplumen.io"],
  ingestApiKey: "test-ingest-key",
  port: 4310,
  databaseUrl: "postgres://example",
  dbSsl: true,
  openSearch: {
    node: "https://opensearch.example",
    index: "ocp-domestic-jobs-catalog-vectors-v1",
  },
  embedding: {
    baseUrl: "https://embedding.example/v1",
    model: "text-embedding-v4",
    dimension: 1024,
    enabled: true,
  },
  semanticEnabled: true,
  maxQueryLimit: 50,
  defaultRecallLimit: 2000,
};

describe("manifest policy", () => {
  test("declares match_candidate as rerank and filter pack as filter-only", () => {
    const manifest = buildManifest(config, {});
    const capability = manifest.query_capabilities[0];
    expect(capability).toBeDefined();
    if (!capability) throw new Error("missing query capability");
    const packs = new Map(capability.query_packs.map((pack) => [pack.pack_id, pack]));
    expect(packs.get("ocp.job.domestic.filter.v1")?.metadata?.ranking_policy).toMatchObject({
      rerank: "none",
    });
    expect(packs.get("ocp.job.domestic.match_candidate.v1")?.metadata?.ranking_policy).toMatchObject({
      rerank: "computer_jobs_only",
    });
  });
});
