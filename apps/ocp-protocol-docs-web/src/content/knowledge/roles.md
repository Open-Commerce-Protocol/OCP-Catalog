---
title: Role model
description: OCP splits Catalog discovery, indexing, sourcing, resolution, and action execution into distinct roles, so each carries clear authority, responsibility, and audit boundaries.
slug: /docs/concepts/roles
category: concepts
order: 3
---

# Role model

> OCP's auditability comes from a single decision: at the protocol layer, **roles are separated**. This page lists OCP's core roles and highlights the boundaries most often confused — for example, a Registration Node is not a product search engine.

## Overview

OCP separates the responsibilities of **discovering catalogs**, **indexing commercial objects**, **providing object data**, **querying and resolving objects**, **executing actions**, and **routing across federations** into distinct roles. Each role only answers the questions that belong to it; everything else is delegated.

## The problem

When one component plays multiple roles, anti-patterns appear:

- The same component is database, search engine, and order gateway — permission scopes and failure domains tangle.
- A registration node that indexes both "which catalogs exist" and "which products exist" becomes either a giant product database or a confused search path.
- An agent reads and writes merchant private tables, conflating "find" and "place order" in a single call and bypassing user confirmation.

OCP avoids these with role separation: each role only answers its question; everything else is forwarded.

## What this is not

- Not a list of organizations or vendors — it's a protocol-level division of responsibility.
- Not a legal entity boundary — one company can play multiple roles.
- Not a process or microservice boundary — one process can implement several roles as long as it respects each protocol surface.
- Not technical-stack layering (frontend / backend / database).

## Core roles

| Role | What it answers | What it does **not** answer |
| --- | --- | --- |
| **OCP** (protocol foundation) | Shared semantics for discovery, query, resolve, permission, provenance, trust, action binding, federation | Internal data structures of any specific platform |
| **Registration Node** | "Which catalogs exist? How do I route to the right one?" | What specific products, jobs, or services exist |
| **Catalog Node** | "What objects can I query here? What are the candidates? How do I resolve them?" | Authority over the truth, inventory, or state of an object |
| **Provider** | "What are these objects' fields, sources, update times, and lifecycle?" | Global ranking, cross-catalog search, or action execution |
| **Agent / User** | "What does the user want? Which catalog? Do we have confirmation?" | Indexing, field authority, payment authorization |
| **Action Provider** | "Execute `buy` / `book` / `apply` / `contact` / `quote` and similar actions." | Catalog-internal retrieval or ranking |
| **Federation Router** | "Cross-catalog discovery, aggregation, routing, trust propagation" | Replicating full remote object data by default |

A few boundaries that are easy to confuse:

- **A Registration Node is not a product search engine.** Its query target is *catalog metadata*, not commercial objects. An agent searches for "which catalog fits my intent," not "which item is cheapest."
- **A Provider is not the same as an Action Provider.** A Provider is the **source** of an object; an Action Provider is the **executor** of an action. One merchant can play both, but at the protocol layer they are two surfaces.
- **A Catalog Node is not an order system.** A Catalog exposes ActionBindings (action entry points); the action itself runs in an Action Provider or business system.
- **Agent discipline.** Agents use only the Query Packs and filter fields declared by the manifest; they must not invent fields, must not skip resolve, and must obtain explicit user confirmation for `checkout` / `apply` / `book` / `contact`.

Typical combinations in practice:

- A WooCommerce store usually plays both **Provider** and **Action Provider** — see [WooCommerce integration overview](/knowledge/woocommerce-overview).
- The Visa VIC reference agent acts as **Agent** and combines a separate **Payment Trust** layer — see [Visa VIC reference agent](/knowledge/visa-vic-reference-agent).
- A public commerce catalog plays **Catalog Node**, aggregates multiple Providers, and registers with a Registration Node.

## See also

- [What is OCP](/knowledge/what-is-ocp)
- [What is a Catalog](/knowledge/what-is-catalog)
- [Search / Resolve / Action](/knowledge/search-resolve-action)
- [Catalog architecture](/knowledge/catalog-architecture)
- [WooCommerce integration overview](/knowledge/woocommerce-overview)
- [Visa VIC reference agent](/knowledge/visa-vic-reference-agent)
