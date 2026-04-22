# Build A Minimal Catalog

This page shows the smallest catalog that is still useful to the OCP protocol.

The target is intentionally narrow:

- one stable `catalog_id`
- one discovery document
- one manifest
- one query endpoint
- one Center registration request

## What This Minimal Catalog Supports

The query contract is deliberately tiny:

- one request field: `example_filed`
- type: `boolean`
- one deterministic response object

When `example_filed` is `true`, the catalog returns:

```text
hello world! true example filed
```

When `example_filed` is `false`, it returns:

```text
hello world! false example filed
```

## Minimal Runtime

```ts
import { Elysia } from 'elysia';

const baseUrl = 'https://catalog.example.com';

new Elysia()
  .get('/.well-known/ocp-catalog', () => ({
    ocp_version: '1.0',
    kind: 'WellKnownCatalogDiscovery',
    catalog_id: 'hello_catalog',
    catalog_name: 'Hello Catalog',
    manifest_url: `${baseUrl}/ocp/manifest`,
    query_url: `${baseUrl}/ocp/query`,
  }))
  .get('/ocp/manifest', () => ({
    ocp_version: '1.0',
    kind: 'CatalogManifest',
    catalog_id: 'hello_catalog',
    catalog_name: 'Hello Catalog',
    description: 'Minimal example catalog with one boolean query field.',
    endpoints: {
      query: {
        url: `${baseUrl}/ocp/query`,
      },
    },
    query_capabilities: [
      {
        capability_id: 'hello.example.query.v1',
        query_packs: [
          {
            pack_id: 'hello.example.query.v1',
            query_modes: ['filter'],
          },
        ],
        supports_explain: true,
        supports_resolve: false,
        metadata: {
          query_contract: {
            type: 'object',
            properties: {
              example_filed: {
                type: 'boolean',
              },
            },
          },
        },
      },
    ],
    object_contracts: [],
  }))
  .post('/ocp/query', async ({ body }) => {
    const request = typeof body === 'object' && body ? body as Record<string, unknown> : {};
    const exampleFiled = request.example_filed === true;

    return {
      ocp_version: '1.0',
      kind: 'CatalogQueryResult',
      catalog_id: 'hello_catalog',
      result_count: 1,
      items: [
        {
          entry_id: 'hello_entry',
          object_id: 'hello_object',
          object_type: 'example',
          provider_id: 'hello_catalog',
          title: `hello world! ${exampleFiled} example filed`,
          score: 1,
          attributes: {
            message: `hello world! ${exampleFiled} example filed`,
          },
        },
      ],
      explain: [
        `example_filed = ${exampleFiled}`,
      ],
    };
  })
  .listen(4000);
```

## Why This Is Enough

That tiny server already satisfies the core catalog obligations:

- a Center can fetch discovery from `/.well-known/ocp-catalog`
- a Center can fetch your manifest from `/ocp/manifest`
- an agent can learn the query contract from the manifest metadata
- an agent can call `/ocp/query`

It is not feature-rich, but it is protocol-participating.

## Registering The Catalog To A Center

Once the catalog is online, registration is just one HTTP request:

```ts
await fetch('https://center.example.com/ocp/catalogs/register', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    ocp_version: '1.0',
    kind: 'CatalogRegistration',
    id: 'catreg_hello_catalog_v1',
    center_id: 'my_center',
    catalog_id: 'hello_catalog',
    registration_version: 1,
    updated_at: new Date().toISOString(),
    homepage: 'https://catalog.example.com',
    well_known_url: 'https://catalog.example.com/.well-known/ocp-catalog',
    claimed_domains: ['catalog.example.com'],
    intended_visibility: 'public',
    tags: ['example'],
  }),
});
```

## Lifecycle

```text
catalog process starts
-> serves discovery + manifest + query
-> posts CatalogRegistration to a Center
-> Center fetches discovery and manifest
-> Center verifies and health-checks the catalog
-> agents can route queries to /ocp/query
```

## Practical Notes

- For local development, this can run on `localhost`.
- For public Center participation, expect to need a stable domain and HTTPS.
- The catalog usually needs to stay online, because agents query it directly.
- `operator` metadata is optional and not required for registration.

## Related Pages

- [Getting Started](/getting-started)
- [CatalogManifest](/handshake/catalog-manifest)
- [CatalogRegistration](/center/catalog-registration)
- [Center Flow](/examples/center-flow)
