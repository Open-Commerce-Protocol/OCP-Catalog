# CLI Usage

Use the OCP CLI for protocol calls. The CLI returns structured JSON so agents can inspect command help and command results without parsing terminal prose.

## Help

Standalone skill bundle:

```bash
bun scripts/ocp-skill-runner.ts help
bun scripts/ocp-skill-runner.ts registration --help
bun scripts/ocp-skill-runner.ts catalog query --help
```

Installed CLI:

```bash
ocp help
ocp registration --help
ocp catalog query --help
```

Top-level help explains the OCP workflow. Domain help explains a protocol stage. Command help explains one command's purpose, options, and examples.

## Registration Commands

Registration commands work with Catalog metadata and routing. They do not search products, services, jobs, or other commercial objects.

```bash
bun scripts/ocp-skill-runner.ts registration discover https://ocp.deeplumen.io/.well-known/ocp-registration
```

Reads the Registration discovery document and finds manifest, catalog search, and route resolution endpoints.

```bash
bun scripts/ocp-skill-runner.ts registration search --registration-url https://ocp.deeplumen.io/registry --query "commerce"
```

Searches for suitable Catalogs by metadata, domain, capability, health, trust, and routing hints. It does not return CatalogEntry product results.

```bash
bun scripts/ocp-skill-runner.ts registration resolve --registration-url https://ocp.deeplumen.io/registry --catalog-id cat_local_dev
```

Resolves a selected Catalog id into a route hint or routing details. This is different from `catalog resolve`, which resolves one object entry.

## Catalog Commands

Catalog commands operate on one selected Catalog. Inspect the manifest before query or resolve.

```bash
bun scripts/ocp-skill-runner.ts catalog inspect http://localhost:4000/ocp/manifest
```

Reads the Catalog manifest so the agent can see endpoints, supported query packs, filter fields, object types, resolve capability, and auth policy.

```bash
bun scripts/ocp-skill-runner.ts catalog query --query-url http://localhost:4000/ocp/query --query-pack ocp.query.keyword.v1 --query "running shoes"
```

Searches commercial objects in the selected Catalog. Use only a `query_pack` declared by the manifest. If the Catalog can choose a default pack, `--query-pack` may be omitted.

Add `--manifest <file-or-url>` when an agent is preparing a request and should receive local validation errors before the query is sent. With a manifest, the CLI rejects unsupported query packs and filters and can fill the selected query pack when it is omitted.

```bash
bun scripts/ocp-skill-runner.ts catalog query --manifest http://localhost:4000/ocp/manifest --query-url http://localhost:4000/ocp/query --filters "{\"category\":\"shoes\"}"
```

Filters must be a JSON object using only fields accepted by the selected Catalog.

```bash
bun scripts/ocp-skill-runner.ts catalog resolve --resolve-url http://localhost:4000/ocp/resolve --entry-id <entry_id>
```

Resolves one selected query result entry for details, freshness, policy context, visible attributes, or action bindings. Do not use resolve as a bulk search replacement.

## Validation And Activity

```bash
bun scripts/ocp-skill-runner.ts validate manifest http://localhost:4000/ocp/manifest
bun scripts/ocp-skill-runner.ts validate query --manifest http://localhost:4000/ocp/manifest --query "running shoes" --filters "{\"category\":\"shoes\"}"
bun scripts/ocp-skill-runner.ts events tail --activity-url https://ocp.deeplumen.io
```

`validate manifest` checks a local or remote Catalog manifest against the schema. `validate query` checks an agent's proposed query against that manifest before sending it: unsupported `query_pack` values, unsupported filter fields, invalid pagination, and missing semantic query text return explicit correction details. `events tail` reads the redacted public Activity API projection, not raw audit payloads.

Use `--api-key` when the target endpoint requires an API key. Use `--correlation-id` to link a command to server-side activity events. Do not put tracing or telemetry fields inside strict OCP request bodies.

## Skill Management

```bash
ocp setup --target auto
ocp skill install --target both
ocp skill update --target auto
ocp skill doctor --target both
```

The standalone runner does not require the full OCP Catalog repository. It uses a bundled CLI when the skill was exported with `bun run skill:ocp:export`; otherwise set `OCP_CLI_COMMAND`, set `OCP_CLI_BIN`, or install an `ocp` binary on PATH.
