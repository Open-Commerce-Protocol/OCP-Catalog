# RegistrationResult

`RegistrationResult` is the structured feedback returned after a provider registration attempt.

## Status Model

The current schema supports:

```json
{
  "status": {
    "enum": [
      "accepted_full",
      "accepted_limited",
      "rejected",
      "pending_verification"
    ]
  }
}
```

## Main Fields

```json
{
  "properties": {
    "matched_object_contract_count": { "type": "integer" },
    "effective_registration_version": { "type": "integer" },
    "selected_sync_capability": {
      "type": "object"
    },
    "missing_required_fields": { "type": "array" },
    "warnings": { "type": "array" },
    "message": { "type": "string" }
  }
}
```

## Why It Matters

The registration result returns structured registration feedback.

It tells the provider:

- whether registration is fully accepted
- how many object contracts matched
- which sync capability was selected
- whether fields are missing
- whether the active version changed

That feedback is what a provider admin UI should surface before attempting full sync.
