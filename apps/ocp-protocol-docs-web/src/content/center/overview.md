# Center Overview

`ocp.catalog.center.v1` defines how catalogs register into an OCP Center and how agents discover them.

## Core Responsibility

The Center answers:

> Which catalog should I query next?

It does not answer:

> Which product should I buy?

That second question belongs to the catalog itself.

## Center Objects

The package includes:

- `CenterDiscovery`
- `CenterManifest`
- `CatalogRegistration`
- `CatalogSearchRequest`
- `CatalogSearchResult`
- `CatalogRouteHint`
- verification and refresh result types

## Current Runtime Role

In this repository, the Center:

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
