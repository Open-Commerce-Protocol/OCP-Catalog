# Registration Discovery

Registration discovery is the well-known document that bootstraps access to an OCP Catalog Registration node.

The current wire schema still uses the legacy `CenterDiscovery` kind and `center_*` field names for compatibility. Treat those names as compatibility identifiers, not as a claim that OCP has a central authority.

## Required Fields

```json
{
  "required": [
    "ocp_version",
    "kind",
    "center_id",
    "center_name",
    "center_protocol",
    "center_protocol_version",
    "manifest_url",
    "catalog_registration_url",
    "catalog_search_url"
  ]
}
```

## Example Fragment

```json
{
  "kind": "CenterDiscovery",
  "center_id": "ocp_center_local_dev",
  "center_name": "OCP Catalog Registration node Local Dev",
  "center_protocol": "ocp.catalog.center.v1",
  "manifest_url": "http://localhost:4100/manifest",
  "catalog_registration_url": "http://localhost:4100/catalogs/register",
  "catalog_search_url": "http://localhost:4100/catalogs/search"
}
```

## Why It Exists

Without a discovery document, every client would need out-of-band endpoint knowledge.

This document makes the registration node self-describing at the entry point.
