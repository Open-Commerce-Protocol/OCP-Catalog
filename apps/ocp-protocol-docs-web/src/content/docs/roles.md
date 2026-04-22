# Roles

This protocol has four practical roles in the current repository.

## Center

The Center helps answer:

> Which catalog should the agent ask next?

The Center is best understood as a catalog of catalogs.

It does not serve products directly. It indexes catalog metadata, trust state, route hints, and manifest snapshots so that agents can decide which catalog to use.

Just as importantly, OCP Center is not a mandatory central authority. The protocol is explicitly decentralized:

- anyone can run an OCP Center
- different operators can run different Centers with different intake, trust, and governance policies
- a catalog can choose which Center or Centers to register with
- an agent or application can choose which Center or Centers to trust

That means the existence of one public or official Center does not make the protocol itself centralized.

## Catalog

The Catalog is the query-serving node.

It is responsible for:

- publishing a manifest
- defining object contracts
- accepting provider registrations
- ingesting synchronized objects
- exposing query and resolve endpoints

## Provider

The Provider is the object supplier.

It is responsible for:

- declaring what object types and packs it can provide
- sending versioned registration updates
- synchronizing concrete objects into the catalog

## Agent

The Agent is the consuming side.

It is responsible for:

- selecting a catalog through the Center
- reading catalog capability information
- issuing query requests against the selected catalog
- resolving selected entries into final actions

## Role Graph

```text
Provider -> Catalog -> Center
                 ^
                 |
               Agent
```

## Why This Split Matters

This split keeps three different concerns separate:

- object supply
- catalog serving
- network-level discovery

That separation is what makes the current demo chain workable with more than one provider and more than one catalog.

It also keeps protocol power distributed:

- providers do not depend on a single discovery authority
- catalogs do not need permission from one global operator to exist
- Centers can compete or specialize without changing the handshake protocol
