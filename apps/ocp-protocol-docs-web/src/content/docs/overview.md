# OCP Catalog Protocol

This site documents the protocol surface implemented in the current repository for OCP Catalog.

It focuses on two protocol layers:

- `ocp.catalog.handshake.v1`
- `ocp.catalog.center.v1`

## What This Protocol Solves

The protocol separates the catalog supply side from the catalog discovery side.

At a high level:

1. Providers tell a catalog what objects they can supply.
2. Catalogs expose query and resolve capability over those objects.
3. Catalogs register themselves to an OCP Center.
4. User-side agents ask the Center which catalog to use.
5. Agents route to the selected catalog and perform query and resolve there.

## Protocol Boundaries

The protocol is intentionally split.

### Handshake

`ocp.catalog.handshake.v1` handles:

- `Provider -> Catalog`
- catalog manifest discovery
- object contracts
- provider registration
- shared commercial object envelope

It does **not** own Center registration or catalog federation.

### Center

`ocp.catalog.center.v1` handles:

- `Catalog -> Center`
- Center discovery
- catalog registration
- catalog search
- route hint delivery

It does **not** index products directly.

## Current Repository Status

This workspace already runs the end-to-end path below:

```text
Catalog startup
-> Catalog registers to Center
-> Provider registers to Catalog
-> Provider syncs commercial objects
-> Agent asks Center for a Catalog
-> Agent queries Catalog
-> Agent resolves a chosen result
```

## Design Notes

The current implementation follows two important conventions.

### Query Packs Are the Main Search Contract

Catalogs tell agents how to search primarily through `query_packs`, not through a flat list of modes.

Example:

```json
{
  "query_packs": [
    {
      "pack_id": "ocp.commerce.product.search.v1",
      "query_modes": ["keyword", "filter", "semantic", "hybrid"],
      "metadata": {
        "query_hints": {
          "supported_query_languages": ["en"]
        }
      }
    }
  ]
}
```

### Optional Hints Live in Metadata

Extra hints such as language support, semantic search guidance, or filter hints are treated as optional metadata rather than top-level required protocol axes.

This keeps the protocol stable while still giving agents useful planning hints.

## How To Read This Site

- Start with [Roles](/roles)
- Then read the Handshake overview
- Then read the Center overview
- Finally inspect the example flows
