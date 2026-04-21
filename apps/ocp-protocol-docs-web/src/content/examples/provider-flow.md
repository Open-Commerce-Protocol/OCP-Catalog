# Provider Flow

This example flow shows how a commerce provider joins the catalog.

## Lifecycle

```text
Provider startup
-> fetch catalog manifest
-> inspect object contracts
-> inspect provider_contract.sync_capabilities
-> submit ProviderRegistration
-> receive RegistrationResult
-> if selected_sync_capability is catalog-hosted push, sync CommercialObject batches
```

## Repository Behavior

In the current workspace:

- the provider admin API can seed demo products
- the provider can register itself to the commerce catalog
- the catalog negotiates `ocp.push.batch`
- the provider then publishes product objects into the catalog
- full sync runs are recorded and surfaced in the provider admin UI

## Important Rule

The provider must be active for the selected registration version before sync succeeds.

That rule is what protects the catalog from accepting objects against stale declarations.
