# Unified Selection Payment Flow

The meal planner uses one unified day payment for premium meal selections and paid one-time add-ons.

The create-payment snapshot is the source of truth for verification. When the provider reports `paid`, the backend applies exactly the items captured in:

- `payment.metadata.premiumSelections`
- `payment.metadata.oneTimeAddonSelections`

Verification must not recalculate a fresh payable set and settle whatever happens to be pending at that moment. Current day state is used only to validate and locate the snapshot rows.

## Troubleshooting

### Verify paid but add-ons remain pending

Bad state:

```json
{
  "payment": {
    "amount": 6200,
    "status": "paid",
    "applied": true
  },
  "paymentRequirement": {
    "requiresPayment": true,
    "addonPendingPaymentCount": 2,
    "pendingAmountHalala": 3200
  }
}
```

This means the provider payment was finalized, but not every add-on row from `metadata.oneTimeAddonSelections` was converted from `pending_payment` to `paid`.

Correct state after verification:

```json
{
  "payment": {
    "amount": 6200,
    "status": "paid",
    "applied": true
  },
  "paymentRequirement": {
    "requiresPayment": false,
    "addonPendingPaymentCount": 0,
    "pendingAmountHalala": 0
  }
}
```

For already-applied paid payments, verification runs an idempotent reconciliation pass. It matches add-ons by the snapshot row id when present, then falls back to `addonId`, unit price, and currency for older snapshots. Only matched snapshot add-ons are settled and stamped with the unified payment id.

### `invalid_addon_metadata` on fresh unified payments

This means create payment did not store add-on snapshot metadata in the shape verify expects. The backend must persist its locally-built payment snapshot, not rely on provider-returned metadata for nested add-on rows.

Correct metadata shape:

```json
{
  "metadata": {
    "oneTimeAddonSelections": [
      {
        "addonSelectionId": "DAY_ADDON_ROW_ID",
        "addonId": "ADDON_ID",
        "priceHalala": 1300,
        "currency": "SAR",
        "source": "pending_payment"
      }
    ]
  }
}
```
