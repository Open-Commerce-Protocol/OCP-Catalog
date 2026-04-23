# Routing Principles

This page explains how routing is intended to work across Registration node and Catalog.

## Route Hint Is A Summary, Not A Full Mirror

`CatalogRouteHint` should help the agent decide whether a catalog is worth asking.

It should not try to mirror the entire manifest.

That is why route hint focuses on:

- routeable endpoints
- supported object types
- supported query packs
- trust and health state
- cacheability

## Manifest Remains The Detailed Capability Document

If the agent needs deeper detail, it should follow `manifest_url`.

This keeps Registration node lightweight and keeps capability truth with the catalog.

## Route Selection Happens Before Query Execution

The intended order is:

1. search Registration node
2. pick a catalog
3. inspect route hint or manifest if needed
4. query the catalog
5. resolve a result

That ordering is important because it stops Registration node from turning into a product search engine.

## Trust And Health Matter At Routing Time

The agent should be able to use Registration node metadata to prefer:

- verified catalogs
- healthier catalogs
- catalogs whose query packs match the user task

This lets routing stay explainable without forcing the agent to inspect every manifest in detail first.
