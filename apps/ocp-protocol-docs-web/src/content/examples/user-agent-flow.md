# User And Agent Flow

This example flow shows how a user-side agent consumes the protocol.

## Lifecycle

```text
User states intent
-> agent checks local catalog profiles
-> if empty, agent searches Center
-> agent selects a candidate catalog
-> user confirms local registration
-> agent queries catalog
-> agent resolves a chosen result
```

## Repository Implementation

The current user demo does two important things:

- it does not expose raw tool results directly to the user
- it lets the agent digest Center and Catalog responses and then explain them

The current repository example is now more concrete than a generic "search some catalog" flow:

- Center search returns a route hint for the commerce catalog
- the agent queries the commerce catalog with `query_pack = ocp.commerce.product.search.v1`
- the catalog can use keyword, filter, hybrid, and optionally semantic retrieval
- query results now carry commerce attributes such as price, image, availability, and quality tier
- the agent resolves a selected `entry_id`, not just an `object_id`

## Why Center And Catalog Stay Separate

The agent first solves:

> which catalog should I use?

Then it solves:

> which product from that catalog should I surface?

Keeping those decisions separate is the main point of the two-layer protocol split.

## Current Repository Example

The current verified path in this workspace looks like:

```text
User asks for travel headphones
-> agent searches Center for a commerce-capable catalog
-> agent receives the commerce catalog route hint
-> agent queries that catalog with price/image/availability-aware ranking
-> agent gets back rich and basic product candidates
-> agent resolves the chosen entry into a ResolvableReference with visible product fields and view_product action
```
