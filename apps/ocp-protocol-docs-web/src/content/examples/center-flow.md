# Center Flow

This example page describes the real `Catalog -> Center` runtime that ships in this repository.

## Real Lifecycle

```text
catalog admin submits CatalogRegistration
-> Center validates center_id and registration_version
-> Center fetches /.well-known/ocp-catalog and the catalog manifest
-> Center validates fetched identity and endpoint/domain consistency
-> Center checks the catalog query endpoint for health
-> Center stores registration record and manifest snapshot
-> if localhost, Center auto-verifies and indexes immediately
-> otherwise Center creates verification challenges and waits for verify
-> after verification, Center indexes the active snapshot and can issue catalog_access_token
-> later refresh re-fetches discovery/manifest and updates the active snapshot
```

## What The Current Implementation Actually Persists

The current Center runtime stores several layers of state, not just one registration row:

- `catalog_registration_records`
- `registered_catalogs`
- `catalog_manifest_snapshots`
- `catalog_index_entries`
- `catalog_verification_records`
- `catalog_health_checks`
- `catalog_search_audit_records`

That separation matters because the runtime treats registration history, active catalog state, snapshots, search index, verification, and health as related but different lifecycle concerns.

## Registration State In The Current Repository

For one `catalog_id`, the current implementation distinguishes several runtime outcomes:

- `stale_ignored`
  The registration was recorded, but its `registration_version` did not supersede the active one.
- `accepted_pending_verification`
  The registration and snapshot were accepted, but the catalog is not yet indexed for general use.
- `accepted_indexed`
  The catalog has an active indexed snapshot.

Two concrete behaviors are important:

- localhost catalogs are auto-verified and can be indexed immediately
- non-localhost catalogs receive verification challenges before they become indexed

## Verification, Token, And Refresh Behavior

The current implementation also has a concrete control-plane workflow:

- `verify` checks pending DNS TXT or HTTPS well-known challenges
- successful verification upgrades trust and indexes the active snapshot
- `catalog_access_token` is issued when the catalog becomes indexed if no token exists yet
- `refresh` and `token/rotate` require that catalog token
- the refresh scheduler only scans catalogs that are already `verified` and `accepted_indexed`

So in this repository, verification is not only about trust metadata. It is also the gate that moves many catalogs into the searchable Center index.

## Health And Indexing

The current Center does not treat health as a passive metadata field. It actively checks the catalog by calling the query endpoint and recording the result.

That health status then feeds into:

- whether a newly registered catalog is indexed right away
- whether a refreshed snapshot stays indexable
- the trust and health information returned in route hints

## Current Repository Example

The current verified path in this workspace looks like:

```text
catalog admin posts CatalogRegistration
-> Center fetches the catalog discovery document
-> Center fetches the manifest
-> Center sends a minimal POST /ocp/query health probe
-> Center stores registration + snapshot
-> localhost demo catalog is auto-verified
-> Center writes catalog_index_entries
-> user-side agent can now find the catalog through Center search
-> later refresh re-fetches manifest and updates the active snapshot
```

## Why This Example Matters

This repository's Center flow is more than a schema demo:

- registration is versioned and stateful
- snapshots are first-class runtime objects
- verification, indexing, and token issuance are connected
- Center search runs over an internal catalog metadata index, not raw remote catalogs
- route hints are derived from active indexed snapshots, not from unverified registration input alone
