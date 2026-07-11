import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { buildServer } from "../src/http/server";
import type { AppConfig } from "../src/config";

const config: AppConfig = {
  catalogId: "cat_ocp_domestic_jobs_prod",
  catalogName: "OCP Domestic Jobs Matching Catalog",
  publicBaseUrl: "https://domesticjobs.catalog.pageflux.net",
  corsAllowedOrigins: ["https://ocp.deeplumen.io"],
  ingestApiKey: "test-ingest-key",
  port: 4310,
  databaseUrl: "postgres://example",
  dbSsl: true,
  openSearch: { node: "https://opensearch.example", index: "domestic-jobs" },
  embedding: { baseUrl: "https://embeddings.example", model: "model", dimension: 1024, enabled: true },
  semanticEnabled: true,
  maxQueryLimit: 50,
  defaultRecallLimit: 2000,
};

describe("catalog health contract", () => {
  test("returns the strict OCP health shape when dependencies are ready", async () => {
    const app = await buildServer(config, {
      jobs: { dataProfile: async () => ({ catalog_entry_count: 0, object_counts: [], counted_at: new Date().toISOString() }) } as never,
      search: { health: async () => ({ body: { status: "green" } }) } as never,
    } as never);
    const response = await app.inject({ method: "GET", url: "/ocp/health" });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      kind: "CatalogHealth",
      catalog_id: config.catalogId,
      status: "healthy",
      ready: true,
      dependencies: [
        { name: "postgres", status: "healthy" },
        { name: "opensearch", status: "healthy" },
      ],
    });
  });

  test("returns schema failures as explicit client errors", async () => {
    const app = await buildServer(config, {
      jobs: { dataProfile: async () => ({ catalog_entry_count: 0, object_counts: [], counted_at: new Date().toISOString() }) } as never,
      search: { health: async () => ({ body: { status: "green" } }) } as never,
      query: { query: () => z.object({ required: z.string() }).parse({}) } as never,
    } as never);
    const response = await app.inject({ method: "POST", url: "/ocp/query", payload: {} });
    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "invalid_request" } });
  });

  test("does not expose internal exception details", async () => {
    const app = await buildServer(config, {
      query: { query: () => { throw new Error("opensearch.internal:9200 secret-index"); } } as never,
    } as never);
    const response = await app.inject({ method: "POST", url: "/ocp/query", payload: {} });
    await app.close();

    expect(response.statusCode).toBe(500);
    const payload = JSON.parse(response.body) as unknown;
    expect(payload).toEqual({
      error: { code: "internal_error", message: "The service encountered an internal error." },
    });
    expect(response.body).not.toContain("opensearch.internal");
    expect(response.body).not.toContain("secret-index");
  });

  test("allows WebMCP CORS requests and rejects undeclared origins", async () => {
    const app = await buildServer(config, {
      jobs: { dataProfile: async () => ({ catalog_entry_count: 0, object_counts: [], counted_at: new Date().toISOString() }) } as never,
      search: { health: async () => ({ body: { status: "green" } }) } as never,
    } as never);

    const preflight = await app.inject({
      method: "OPTIONS",
      url: "/ocp/query",
      headers: {
        origin: "https://ocp.deeplumen.io",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });
    const rejectedOrigin = await app.inject({
      method: "GET",
      url: "/ocp/manifest",
      headers: { origin: "https://untrusted.example" },
    });
    await app.close();

    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers["access-control-allow-origin"]).toBe("https://ocp.deeplumen.io");
    expect(rejectedOrigin.headers["access-control-allow-origin"]).toBeUndefined();
  });

  test("requires an exact API key for both ingestion endpoints", async () => {
    const app = await buildServer(config, {
      ingest: { sync: async () => ({ accepted_count: 0, failed_count: 0 }) } as never,
    } as never);
    const missing = await app.inject({ method: "POST", url: "/ocp/objects/sync", payload: {} });
    const invalid = await app.inject({ method: "POST", url: "/ocp/objects/sync/stream", headers: { "x-api-key": "wrong" }, payload: "" });
    const valid = await app.inject({ method: "POST", url: "/ocp/objects/sync", headers: { "x-api-key": config.ingestApiKey }, payload: {} });
    await app.close();

    expect(missing.statusCode).toBe(401);
    expect(invalid.statusCode).toBe(401);
    expect(valid.statusCode).toBe(200);
  });
});
