# Verification And Refresh

The Center package also includes control-plane objects for catalog verification, refresh, and token rotation.

## Verification Request

The current verification request is intentionally small.

```json
{
  "properties": {
    "ocp_version": { "const": "1.0" },
    "kind": { "const": "CatalogVerificationRequest" },
    "challenge_id": { "type": "string" }
  }
}
```

The challenge lifecycle lets the Center confirm that the registering catalog actually controls the claimed endpoint or domain.

## Refresh Result

```json
{
  "required": [
    "ocp_version",
    "kind",
    "id",
    "center_id",
    "catalog_id",
    "status",
    "health_status",
    "indexed",
    "warnings",
    "refreshed_at"
  ]
}
```

This result tells the catalog whether a refresh successfully produced a healthy, indexable snapshot.

## Token Rotation Result

```json
{
  "required": [
    "ocp_version",
    "kind",
    "id",
    "center_id",
    "catalog_id",
    "catalog_access_token",
    "token_issued_at"
  ]
}
```

## Why These Objects Matter

These objects do not affect agent-facing product search directly, but they matter for operating a multi-catalog network:

- verification keeps registration trustworthy
- refresh keeps snapshots current
- token rotation keeps operational access bounded
