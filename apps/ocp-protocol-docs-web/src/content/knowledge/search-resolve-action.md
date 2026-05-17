---
title: Search / Resolve / Action
description: OCP splits "from intent to checkout" into three strictly separate phases — Search, Resolve, and Action — each with its own visibility, freshness, permission, and audit profile.
slug: /docs/concepts/search-resolve-action
category: concepts
order: 4
---

# Search / Resolve / Action

> These three phases differ in field visibility, freshness, permission strength, and audit granularity. When they collapse into one, the failure modes are predictable: orders placed without confirmation, stale prices, over-exposed fields.

## Overview

In OCP, a full "intent-to-checkout" flow is split into three **strictly separate** phases:

- **Search** — discover candidates and explain them.
- **Resolve** — return permissioned details and action entry points, in a known identity / purpose context.
- **Action** — execute the action through an Action Provider.

Each phase has its own field visibility, freshness, permission strength, and audit granularity.

## The problem

Collapsing the phases produces three classic failure modes:

1. **Over-exposure** — contact info, exact inventory, or pricing internals leaking into search results bypass permissions.
2. **Stale data** — treating search-time prices or inventory as the snapshot a user will pay against, only to discover it has changed at checkout.
3. **Unauthorized actions** — agents calling merchant APIs to "find and buy" in a single call, without user confirmation or revalidation, and with no audit trail.

Splitting Search / Resolve / Action puts each risk on its own protocol surface.

## What it is not

- Not three parameters on a single endpoint.
- Not three SQL dialects.
- Not a simple two-step "search, then fetch" — Resolve is not search pagination; it returns restricted fields, live validation, ActionBindings, and confirmation requirements.
- Action is **not a Catalog responsibility** — a Catalog exposes ActionBindings, but the actual `buy` / `book` / `apply` runs in the Action Provider or business system.
- Search does not replace Resolve, and Resolve does not replace Search recall.

## Core ideas

| Phase | Responsibility | Input | Output | Typical permission |
| --- | --- | --- | --- | --- |
| **Search** | Candidate discovery, summary, match explanation, provenance hints, freshness | Query (against a manifest-declared Query Pack) | QueryResult / CatalogEntry list + explanations, facets, freshness, warnings | Usually anonymous or weak identity |
| **Resolve** | Restricted detail, live validation, ActionBinding, confirmation requirements — bound to identity / purpose / context | A chosen CatalogEntry + identity / purpose / token | ResolvableReference + restricted fields + live state + ActionBinding + risk notes + TTL | User / agent token + purpose declaration |
| **Action** | Execute `buy` / `create_checkout` / `book` / `apply` / `contact` / `request_quote` / `reserve` / `submit_profile` etc. | ActionBinding + user-confirmed input | Action result or status reference | User confirmation + idempotency + payment trust where required |

Key disciplines:

- **Do not expose pricing internals, exact inventory, contact information, or payment credentials in Search.** These belong in Resolve or Action, under explicit visibility policy.
- **Resolve is not bulk detail retrieval.** Call it after the user has selected a candidate, when restricted fields are needed, when live validation is required, or when an action entry point is needed.
- **Confirm before Action.** Verify user authorization, ActionBinding expiry, schema-conformant inputs, idempotency keys, risk level, and whether automatic execution is allowed.
- **Audit at every phase.** Query exposure, result exposure, restricted-field exposure, ActionBinding exposure, and action invocation all enter the audit ledger.

How this looks in concrete scenarios:

- **WebMCP Demo** turns the search phase into in-browser WebMCP tools: `ocp.mall.search_products` is the Search surface. The Demo's page-open tool (`ocp.mall.open_product_page`) is loosely comparable to an action entry point, but it is **not** a formal OCP ActionBinding or Action Provider execution chain. See [WebMCP demo](/knowledge/webmcp-demo).
- **Visa VIC reference agent** strictly follows the three phases: Search returns candidates → Resolve returns ActionBinding and live pricing → checkout is created only after the user confirms a Payment Instruction. "Purchase must go through Resolve, user confirmation, and Payment Instruction." See [Visa VIC reference agent](/knowledge/visa-vic-reference-agent).
- **WooCommerce integration** maps the Resolve-stage `create_checkout` to `POST /ocp/checkout/create` and requires that price, inventory, taxes, and shipping be revalidated at checkout. See [WooCommerce integration overview](/knowledge/woocommerce-overview).

## See also

- [What is OCP](/knowledge/what-is-ocp)
- [What is a Catalog](/knowledge/what-is-catalog)
- [Role model](/knowledge/roles)
- [Catalog architecture](/knowledge/catalog-architecture)
- [WebMCP demo](/knowledge/webmcp-demo)
- [Visa VIC reference agent](/knowledge/visa-vic-reference-agent)
- [WooCommerce integration overview](/knowledge/woocommerce-overview)
