# Registration Overview

OCP Catalog Registration defines how catalogs register with a registration node and how agents discover them.

The implementation still exposes the legacy schema namespace `ocp.catalog.center.v1` and legacy `Center*` object names. Those names are compatibility details; the conceptual role is registration and discovery in a decentralized protocol.

## Core Responsibility

The Registration node answers:

> Which catalog should I query next?

It does not answer:

> Which object should I choose, and what can I do with it next?

That second question belongs to the catalog itself. A catalog may answer it by resolving a selected entry into a `ResolvableReference` with actions such as `view_product`, `book_slot`, `apply_job`, `send_interview_invite`, or `request_quote`.

## Registration Objects

The package includes:

- `CenterDiscovery`
- `CenterManifest`
- `CatalogRegistration`
- `CatalogSearchRequest`
- `CatalogSearchResult`
- `CatalogRouteHint`
- verification and refresh result types

## Current Runtime Role

In this repository, the Registration node:

- stores catalog registrations
- fetches and indexes manifest snapshots
- exposes catalog search
- returns route hints with trust and health metadata

## Route Hint Principle

The route hint is a summary.

It should tell the agent:

- where the catalog lives
- whether it is trusted and healthy
- which object types and query packs it broadly supports

If the agent needs full capability detail, it should fetch the manifest from `manifest_url`.
