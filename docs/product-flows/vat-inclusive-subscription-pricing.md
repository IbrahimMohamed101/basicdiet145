# VAT-Inclusive Subscription Pricing

This document describes how VAT is handled in the subscription pricing logic to ensure consistency across the API.

## Core Principle

All customer-facing prices in the app are **VAT-inclusive**.
When a plan is configured at 150.00 SAR, the customer pays exactly 150.00 SAR.
The system then extracts the 15% VAT portion (19.57 SAR) from that total to determine the net amount (130.43 SAR).

## Response Naming Convention

To avoid confusion, fields are named explicitly:

- `basePlanPriceHalala`: Customer-facing VAT-inclusive plan price. Always gross.
- `basePlanGrossHalala`: Same as `basePlanPriceHalala`.
- `basePlanGrossSar`: Same as `basePlanGrossHalala` but in SAR.
- `basePlanNetHalala`: Plan price before VAT extracted from inclusive price.
- `basePlanNetSar`: Same as `basePlanNetHalala` but in SAR.
- `subtotalBeforeVatHalala`: Total net before VAT (sum of all net items).
- `vatHalala`: VAT portion included in the total.
- `totalPriceHalala`: Final amount the customer pays (Gross).
- `grossTotalHalala`: Customer-facing line-item total before discounts, still VAT-inclusive.

## Example Object

For a plan price of `15000` halala (150 SAR) and VAT `15%`:

```json
{
  "breakdown": {
    "basePlanPriceHalala": 15000,
    "basePlanGrossHalala": 15000,
    "basePlanNetHalala": 13043,
    "grossTotalHalala": 15000,
    "subtotalBeforeVatHalala": 13043,
    "vatPercentage": 15,
    "vatHalala": 1957,
    "totalPriceHalala": 15000,
    "currency": "SAR"
  },
  "pricingSummary": {
    "basePlanPriceHalala": 15000,
    "basePlanGrossHalala": 15000,
    "basePlanNetHalala": 13043,
    "grossTotalHalala": 15000,
    "subtotalBeforeVatHalala": 13043,
    "vatPercentage": 15,
    "vatHalala": 1957,
    "totalPriceHalala": 15000,
    "currency": "SAR"
  }
}
```

## Backward Compatibility

- `basePriceHalala` is preserved in some objects and maps to `basePlanPriceHalala` (Gross) to avoid breaking older mobile app versions that expect it to be the plan price.
- `totalHalala` is preserved and is identical to `totalPriceHalala`.

## Implementation Files

- `src/utils/pricing.js`: Contains `computeInclusiveVatBreakdown` and `buildMoneySummary`.
- `src/services/subscription/subscriptionQuoteService.js`: Builds the initial quote breakdown.
- `src/services/subscription/subscriptionCheckoutService.js`: Builds the checkout draft breakdown.
- `src/models/CheckoutDraft.js`: Persists the breakdown fields.
- `src/models/Subscription.js`: Persists the final subscription price fields.
