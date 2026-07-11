# Domestic Job Catalog

Production OCP Catalog node for domestic, directly actionable job postings.

This application remains a separate deployable boundary from the overseas job Catalog while sharing the OCP monorepo, quality gates, and release history.

## Runtime

- Fastify HTTP API
- PostgreSQL/RDS for canonical job entries and query audit
- OpenSearch for text/vector candidate generation
- Catalog-owned embedding generation

## OCP endpoints

- `GET /.well-known/ocp-catalog`
- `GET /ocp/manifest`
- `GET /ocp/health`
- `POST /ocp/query`
- `POST /ocp/resolve`
- `POST /ocp/objects/sync`
- `POST /ocp/objects/sync/stream`

## Matching policy

- `ocp.job.domestic.filter.v1`: hard filters only. Does not run semantic retrieval or technical rerank.
- `ocp.job.domestic.match_candidate.v1`: structured candidate profile is required. The catalog computes embeddings and reranks `computer` jobs using structured skill, experience, education, and vector scores.
- `filter_only` jobs never enter the technical reranker.
- `review_required` and `unclassified` jobs are not queryable.

Missing required data fails ingestion or query explicitly. The service does not silently fall back from semantic matching to filter-only results.

## Browser clients

`CORS_ALLOWED_ORIGINS` is required and accepts a comma-separated allowlist of exact origins. Production must include `https://ocp.deeplumen.io` so the WebMCP investor showcase can inspect this Catalog without opening the API to undeclared browser origins.

## Deployment

The systemd templates run from `/home/ubuntu/workspace/OCP-Catalog/apps/domestic-job-catalog`. Runtime secrets remain in `/etc/ocp-domestic-job-catalog.env`; import data and checkpoints remain outside Git.
