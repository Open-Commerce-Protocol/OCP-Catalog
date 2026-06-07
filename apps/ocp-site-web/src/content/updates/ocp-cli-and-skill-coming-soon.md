The CLI turns the standard OCP workflow into commands — discover, search, inspect, query, resolve — and returns structured JSON for both help and results, so agents can act on output without parsing terminal prose.

The most useful piece is manifest-based request validation: before a query is sent, the CLI checks it against the Catalog manifest and rejects an unsupported query pack, an unknown filter field, invalid pagination, or a missing query string — keeping agent parameters clean and moving errors earlier.

It is not published to npm yet, so it is marked as coming soon. To try it now, clone github.com/Open-Commerce-Protocol/OCP-Catalog and run the bundled CLI, or install the standalone skill into your agent. See the docs page CLI & Skill (/docs/cli-and-skill) for the full guide.
