# Marketing Baseline Status

**Date:** 2026-10-07  
**Status:** Analytics infrastructure complete; live snapshot still pending authenticated pull.

## What is ready

The production system can already calculate:
- registrations,
- checkout users/starts,
- paid customers,
- first-time subscribers,
- repeat subscribers,
- conversion rates,
- app/all-channel subscription revenue,
- AOV,
- promo performance,
- plan performance,
- fulfillment,
- payment provider,
- checkout/payment quality,
- daily series,
- previous-period comparison.

Source:
`GET /api/dashboard/accounting/marketing-analytics`

Dashboard:
**المحاسبة -> تحليلات التسويق**

## Snapshot required

Create three aggregate snapshots:
1. last 30 days,
2. last 60 days,
3. last 90 days.

For each capture:
- registrations
- checkout users
- paid customers
- first-time paid subscribers
- repeat paid customers
- Register -> Paid
- Checkout -> Paid
- app revenue
- total subscription revenue
- AOV
- top plan combinations
- promo performance
- fulfillment split
- payment-provider split
- failed/abandoned checkout quality
- cancellations

## Why it is still pending

The production Marketing Analytics route is intentionally protected by dashboard admin authentication.

Current repository/infrastructure connections expose neither the user's active dashboard session nor plaintext production admin credentials. Credentials must not be copied into repository docs or bypassed with a public analytics route.

Therefore no live values are guessed or reconstructed from partial historic chat numbers.

## Is this a blocker?

### Daily organic content
**No.**
Content can begin with product/asset/VOC/competitive grounding and start generating its own performance history.

### Paid scaling / CAC / ROAS decisions
**Yes.**
Before meaningful ad spend is scaled, capture the baseline and source attribution.

## Closure rule

Once an authenticated live pull is available:
- save aggregate-only files under `marketing/analytics/snapshots/`,
- never store PII,
- never overwrite prior snapshots,
- update `STATE.md` from "baseline pending" to "baseline captured."
