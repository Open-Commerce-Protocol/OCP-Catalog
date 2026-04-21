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

## Why Center And Catalog Stay Separate

The agent first solves:

> which catalog should I use?

Then it solves:

> which product from that catalog should I surface?

Keeping those decisions separate is the main point of the two-layer protocol split.
