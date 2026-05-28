# CLI Usage

Use the OCP CLI for all protocol calls.

Standalone skill bundle:

```bash
bun scripts/ocp-skill-runner.ts help
```

Installed CLI:

```bash
ocp help
```

Common commands:

```bash
bun scripts/ocp-skill-runner.ts registration discover https://ocp.deeplumen.io/.well-known/ocp-registration
bun scripts/ocp-skill-runner.ts registration search --registration-url https://ocp.deeplumen.io/registry --query "commerce"
bun scripts/ocp-skill-runner.ts registration resolve --registration-url https://ocp.deeplumen.io/registry --catalog-id cat_local_dev

bun scripts/ocp-skill-runner.ts catalog inspect http://localhost:4000/ocp/manifest
bun scripts/ocp-skill-runner.ts catalog query --query-url http://localhost:4000/ocp/query --query-pack ocp.query.keyword.v1 --query "running shoes"
bun scripts/ocp-skill-runner.ts catalog resolve --resolve-url http://localhost:4000/ocp/resolve --entry-id <entry_id>

bun scripts/ocp-skill-runner.ts events tail --activity-url https://ocp.deeplumen.io
```

Use `--api-key` when the target endpoint requires an API key. Use `--correlation-id` to link a command to server-side activity events.

The standalone runner does not require the full OCP Catalog repository. It uses a bundled CLI when the skill was exported with `bun run skill:ocp:export`; otherwise set `OCP_CLI_COMMAND`, set `OCP_CLI_BIN`, or install an `ocp` binary on PATH.
