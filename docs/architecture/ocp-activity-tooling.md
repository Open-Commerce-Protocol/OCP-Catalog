# OCP Activity And Tooling

## Decisions

- Record authoritative protocol behavior at protocol server boundaries.
- Record client-side attempts and failures in the shared `@ocp-catalog/ocp-client`, not in every adapter or tool.
- Keep raw activity events private. The official site reads only public projections from Activity API.
- Keep OCP request bodies strict. Use Activity API and trace headers for observability.
- Keep the OCP skill distributable as a small standalone skill bundle. It must not require cloning this repository.

## Activity Flow

Protocol servers emit inbound events when a real OCP action succeeds:

- Registration API records catalog registration, search, and resolve.
- Catalog API records provider registration, object sync, query, and resolve.

Shared clients emit outbound events when callers make real network calls:

- `client.call_attempted`
- `client.call_completed`

Adapters such as MCP, CLI, WebMCP, skills, and plugins should use `OcpClient` for outbound Registration/Catalog calls. They may add source metadata such as `source_kind`, `client_kind`, and `source_name`, but they should not duplicate HTTP instrumentation.

## Public Projection

Activity API owns event ingest, redaction, public projection, and rollups.

- Ingest endpoints: `/ocp/audit/events`, `/ocp/audit/events/batch`
- Site endpoints: `/api/activity/recent`, `/api/activity/rollups`
- Public projections must not expose raw payloads, API keys, user query text, private IDs, or full URLs.

## Skill Distribution

The source skill lives in `skills/ocp-catalog`, but users should install it through the OCP CLI:

```bash
ocp setup
ocp skill install --agent agents
ocp skill install --scope project
ocp skill update
ocp update
```

`@ocp-catalog/ocp-cli` is the public distribution package. Its build embeds a version-matched skill bundle at `dist/skills/ocp-catalog`. `ocp skill install` and `ocp skill update` copy from that package-local bundle into the user's skills directory, so users do not need to clone this repository.

CLI-managed installs write `.ocp-skill-install.json`. Updates and uninstalls refuse to overwrite unmanaged same-name skill folders unless `--force` is supplied, so user-edited skills are not silently replaced.

Repository maintainers can still export a standalone skill artifact:

```bash
bun run skill:ocp:export
```

The skill runner resolves the CLI in this order:

1. `OCP_CLI_COMMAND`
2. `OCP_CLI_BIN`
3. bundled skill CLI
4. `ocp` on PATH
5. `bunx @ocp-catalog/ocp-cli`
6. `npx @ocp-catalog/ocp-cli`

Do not add repository-relative CLI paths back into the skill.

## CLI Package

`@ocp-catalog/ocp-cli` is the stable executable boundary for users and skills. It builds to `dist/index.js` and exposes the `ocp` binary.

Before publishing the CLI as a standalone npm package, keep dependencies either bundled into the executable or published as compatible public packages.

## MCP Gateway

MCP tools keep their local adapters for MCP-specific errors and workflow shape, but the adapters delegate Registration/Catalog calls to `OcpClient`.

This means:

- cache hits are not recorded as real protocol calls;
- query API keys, timeout, user-agent, and activity metadata are configured once in `server.ts`;
- MCP error codes remain stable for tools;
- activity recording remains best-effort and must never fail a tool call.
