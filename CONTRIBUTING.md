# Contributing to Open Commerce Protocol — Catalog

Thanks for your interest. This repository hosts both the OCP Catalog
specifications and the reference implementations. Contributions can target
either layer, and the workflow differs slightly for each.

## Code of Conduct

This project follows the [Code of Conduct](./CODE_OF_CONDUCT.md). By
participating you agree to uphold it.

## Before you start

- Check the [issue tracker](https://github.com/Open-Commerce-Protocol/OCP-Catalog/issues)
  to see whether the work is already tracked.
- Open an issue first for protocol-level proposals, breaking changes, or
  anything that touches the wire schemas under
  `ocp.catalog.handshake.v1/` or `ocp.catalog.registration.v1/`.
- Smaller fixes (typos, examples, lint, docs) can go straight to a pull
  request.

## Development setup

Prerequisites:

- Bun `1.3.12+`
- PostgreSQL with the `pgvector` extension

```bash
git clone https://github.com/Open-Commerce-Protocol/OCP-Catalog.git
cd OCP-Catalog
bun install
bun run db:migrate
```

Run the reference services you need — see the
[quick start in README.md](./README.md#quick-start).

## Source of truth and review order

When you touch protocol surfaces, keep these in sync (in this order):

1. `docs/specs/` — spec text
2. `ocp.catalog.handshake.v1/` and `ocp.catalog.registration.v1/` — wire schema
3. `packages/ocp-schema/` and `packages/registration-schema/` — typed schema
4. Reference implementations in `apps/` and `apps/examples/`
5. Documentation in `apps/ocp-site-web/src/content/`

A PR that updates a wire field but not the spec, or vice versa, will be
asked to bring them back in alignment.

## Before opening a PR

```bash
bun run typecheck
bun run build
bun run test
```

For changes that touch a runtime path, also run:

```bash
bun run validate:mvp            # Provider -> Catalog flow
bun run validate:registration   # Catalog -> Registration node flow
bun run test:integration        # Catalog integration tests (needs Postgres)
```

Site changes:

```bash
bun run site:check
```

## Pull request style

- Keep PRs focused. Mixing a refactor with a behavior change makes review hard.
- Commit messages follow Conventional Commits:
  `feat(scope): ...`, `fix(scope): ...`, `chore(scope): ...`, etc.
- Reference any related issues in the PR description.
- For protocol changes, include a short note describing whether the change is
  backwards-compatible and which manifest version it targets.

## Scope reminders

- Don't add new top-level apps without an issue discussion.
- Don't add a second untracked copy of protocol truth inside the site app.
- The `docs/archive/` directory is historical; do not treat archived material
  as current spec authority.

## License of contributions

By contributing you agree that your contributions will be licensed under
the project's [MIT License](./LICENSE).
