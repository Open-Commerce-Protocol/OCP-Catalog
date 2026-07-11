import cors from "@fastify/cors";
import Fastify from "fastify";
import { timingSafeEqual } from "node:crypto";
import { ZodError } from "zod";
import type { AppConfig } from "../config";
import { errorPayload, HttpError } from "../errors";
import { buildDiscovery, buildManifest } from "../manifest";
import type { IngestService } from "../ingest";
import type { QueryService } from "../query";
import type { ResolveService } from "../resolve";
import type { JobSearchIndex } from "../search/opensearch";
import type { JobRepository } from "../storage/postgres";

export type Services = {
  jobs: JobRepository;
  search: JobSearchIndex;
  query: QueryService;
  resolve: ResolveService;
  ingest: IngestService;
};

export async function buildServer(config: AppConfig, services: Services) {
  const app = Fastify({
    logger: true,
    bodyLimit: 64 * 1024 * 1024,
  });
  await app.register(cors, {
    origin: config.corsAllowedOrigins,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["content-type", "x-api-key"],
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send(errorPayload(new HttpError(
        "invalid_request",
        "Request does not satisfy the declared schema.",
        400,
        { issues: error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code, message: issue.message })) },
      )));
    }
    const status = error instanceof HttpError ? error.statusCode : 500;
    if (!(error instanceof HttpError)) {
      app.log.error({ err: error }, "Unhandled request error");
    }
    return reply.status(status).send(errorPayload(error));
  });

  app.get("/", async () => ({
    service: "domestic-job-catalog",
    catalog_id: config.catalogId,
    manifest_url: `${config.publicBaseUrl}/ocp/manifest`,
  }));

  app.get("/.well-known/ocp-catalog", async () => buildDiscovery(config));

  app.get("/ocp/health", async () => {
    const dataProfile = await services.jobs.dataProfile();
    let searchFailure: string | undefined;
    try {
      await services.search.health();
    } catch (error) {
      app.log.error({ err: error }, "OpenSearch health check failed");
      searchFailure = "dependency_unavailable";
    }
    const healthy = searchFailure === undefined;
    return {
      ocp_version: "1.0",
      kind: "CatalogHealth",
      catalog_id: config.catalogId,
      status: healthy ? "healthy" : "unhealthy",
      ready: healthy,
      checked_at: new Date().toISOString(),
      manifest_version: `manifest_${config.catalogId}`,
      details: {
        catalog_name: config.catalogName,
        semantic_enabled: config.semanticEnabled,
        embedding_enabled: config.embedding.enabled,
        data_profile: dataProfile,
      },
      dependencies: [
        { name: "postgres", status: "healthy" },
        healthy
          ? { name: "opensearch", status: "healthy" }
          : { name: "opensearch", status: "unhealthy", message: searchFailure },
      ],
    };
  });

  app.get("/ocp/manifest", async () => {
    const dataProfile = await services.jobs.dataProfile();
    return buildManifest(config, dataProfile);
  });

  app.get("/ocp/contracts", async () => ({
    ocp_version: "1.0",
    kind: "CatalogContracts",
    catalog_id: config.catalogId,
    object_contracts: buildManifest(config, await services.jobs.dataProfile()).object_contracts,
  }));

  app.post("/ocp/query", async (request) => services.query.query(request.body));
  app.post("/ocp/resolve", async (request) => services.resolve.resolve(request.body));
  const requireIngestApiKey = async (request: { headers: Record<string, unknown> }) => {
    const supplied = request.headers["x-api-key"];
    if (typeof supplied !== "string" || !secureEqual(supplied, config.ingestApiKey)) {
      throw new HttpError("unauthorized", "A valid x-api-key is required for Catalog ingestion.", 401);
    }
  };

  app.post("/ocp/objects/sync", { preHandler: requireIngestApiKey }, async (request) => services.ingest.sync(request.body));

  app.post("/ocp/objects/sync/stream", { preHandler: requireIngestApiKey }, async (request) => {
    const text = typeof request.body === "string" ? request.body : JSON.stringify(request.body);
    const objects = text.split(/\r?\n/g)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    return services.ingest.sync({
      ocp_version: "1.0",
      kind: "ObjectSyncRequest",
      catalog_id: config.catalogId,
      objects,
    });
  });

  return app;
}

function secureEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
