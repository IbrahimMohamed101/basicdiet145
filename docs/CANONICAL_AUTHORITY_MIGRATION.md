# Canonical Authority Migration

## Decision

Runtime business decisions use two authorities:

- `resolvePremiumUpgrade(premiumKey)` for premium eligibility, currency, and price.
- `opsTransitionService.executeAction(...)` for operational subscription-day, pickup-request, order, and delivery mutations.

Legacy IDs and status spellings are accepted only at request/read boundaries and normalized before either authority is called. Missing premium configuration fails closed; catalog, settings, product, and builder prices are not runtime fallbacks.

## Flutter compatibility boundary

Flutter response fields remain produced by the existing adapters:

- `subscriptionClientSerializationService` for subscriptions, balances, delivery/pickup summaries, contract snapshots, and legacy nullable wallet fields.
- `orderSerializationService` plus the checkout response mapper in `orderController` for order detail/list/payment payloads.
- `deliveryMapper` for courier delivery DTOs.
- Planner projection functions for canonical slots plus existing materialized/legacy Flutter fields.

No Flutter field was renamed or removed. Canonical fields are backfilled into stored fake data; legacy identifiers are not used for pricing or eligibility.

## Operational API compatibility

Existing mobile paths and response envelopes remain unchanged. Existing kitchen/courier paths delegate internally to `opsTransitionService`. Dashboard order actions now use the same service and may adopt its canonical action DTOs directly.

## Migration prerequisite

Run `node scripts/backfill-premium-upgrades.js` once against existing fake data before exercising premium flows. It creates canonical premium configuration and maps legacy premium `Meal` rows to `premiumKey`. Unresolved identities are reported and are not silently priced.
