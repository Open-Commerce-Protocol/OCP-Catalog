# Security Policy

## Supported scope

This repository is an early reference implementation for the Open Commerce
Protocol Catalog family. Security reports are in scope when they affect:

- Protocol schemas under `ocp.catalog.handshake.v1/` or
  `ocp.catalog.registration.v1/`.
- Runtime services under `apps/`.
- Shared packages under `packages/`.
- Authentication, registration, catalog query, resolve, sync, or token flows.
- Example integrations that could teach unsafe implementation patterns.

Archived design notes under `docs/archive/` are not supported security surfaces.

## Reporting a vulnerability

Do not open a public issue with exploit details.

Preferred path:

1. Use GitHub private vulnerability reporting for this repository if it is
   enabled.
2. If private reporting is not available, contact the maintainers privately.
3. If you cannot find a private channel, use the maintainer contact issue
   template to ask for a security contact. Do not include exploit details in
   that issue.

Include as much of the following as you can:

- Affected component or package.
- Impact and attacker capability.
- Reproduction steps or proof of concept.
- Expected behavior and actual behavior.
- Whether the issue affects protocol text, wire schema, or implementation only.
- Suggested fix, if known.

## Response expectations

Maintainers will acknowledge valid reports when a private channel is available,
triage impact, and decide whether the fix requires a protocol change, a runtime
patch, documentation, or all three.

Because this project is still evolving, breaking security fixes are preferred
over compatibility layers when the old behavior is unsafe.

## Public disclosure

Please wait for maintainer coordination before publishing details. The project
will prefer clear release notes and migration guidance over silently preserving
unsafe behavior.
