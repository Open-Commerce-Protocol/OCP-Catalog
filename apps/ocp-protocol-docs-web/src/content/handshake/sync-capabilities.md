# Sync Capabilities

`SyncCapability` is the formal negotiation surface between Catalog and Provider.

## Why It Exists

`SyncCapability` defines the negotiable sync surface between Catalog and Provider.

It can express:

- snapshot vs delta vs stream
- mutation semantics
- batching limits
- endpoint ownership
- endpoint field requirements
- future bootstrap or auth details

## Catalog Side

The catalog publishes sync capabilities in:

```text
CatalogManifest.provider_contract.sync_capabilities[]
```

Each capability is matched by `capability_id`.

## Provider Side

The provider declares sync intent in:

```text
ProviderRegistration.object_declarations[].sync
```

The declaration surface is intentionally small:

- `preferred_capabilities`
- `avoid_capabilities_unless_necessary`
- `provider_endpoints`

If a capability is absent from both capability lists, it is not declared usable by that provider declaration.

## Example Sync Path

The current commerce provider and catalog examples negotiate:

```json
{
  "preferred_capabilities": ["ocp.push.batch"],
  "avoid_capabilities_unless_necessary": [],
  "provider_endpoints": {}
}
```

The catalog then returns:

```json
{
  "selected_sync_capability": {
    "capability_id": "ocp.push.batch",
    "reason": "provider_preferred_and_supported_by_catalog"
  }
}
```

The example runtime path is:

```text
register
-> selected_sync_capability = ocp.push.batch
-> provider sends batched ObjectSyncRequest payloads
```

## Reserved Capability Guidance

### `ocp.feed.url`

Use this only when the catalog can actively pull provider-hosted feeds.

Implementation requirements:

- provider declares `provider_endpoints.feed_url.url`
- catalog has a fetch scheduler
- catalog can handle snapshot replacement, retries, and checksum/etag logic

### `ocp.pull.api`

Use this only when the catalog can call a provider API directly.

Implementation requirements:

- provider exposes pull endpoints and pagination/cursor contracts
- catalog has API clients, auth handling, and incremental state tracking

### `ocp.streaming`

Use this only when the catalog can consume a continuous stream.

Implementation requirements:

- provider exposes a stable streaming channel or webhook contract
- catalog has reconnect, checkpoint, replay, and idempotent consumption logic

## `provider_endpoints` Shape

`provider_endpoints` is an endpoint map, not a bare string map.

```json
{
  "provider_endpoints": {
    "feed_url": {
      "url": "https://provider.example/catalog-feed.json"
    }
  }
}
```

Wrapping the URL in an object keeps the shape extensible for auth override, content type, refresh hints, checksum URLs, webhook callbacks, or bootstrap metadata.
