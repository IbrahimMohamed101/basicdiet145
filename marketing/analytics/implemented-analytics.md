# Implemented Marketing Analytics

**Implementation status:** Production  
**Documented:** 2026-10-07

## Backend

Repository: `IbrahimMohamed101/basicdiet145`

Endpoint:
`GET /api/dashboard/accounting/marketing-analytics`

Relevant implementation files:
- `src/services/dashboard/marketingAnalyticsService.js`
- `src/controllers/dashboard/marketingAnalyticsController.js`
- `src/routes/dashboardAccounting.js`
- `tests/marketingAnalyticsService.test.js`
- `.github/workflows/marketing-analytics-readonly.yml`

Backend PR:
- #140 — `feat: read-only marketing analytics`
- Merged commit: `20d3006dfd011a68bb0789ffc93d27f1c385e393`

Design:
- read-only queries only,
- no schema mutation,
- no subscription/payment write-path changes,
- existing dashboard admin authentication/authorization,
- Asia/Riyadh reporting-day semantics.

Supported query dimensions include:
- from/to,
- previous-period comparison,
- promo code,
- fulfillment,
- payment provider,
- daysCount,
- grams,
- mealsPerDay.

## Dashboard

Repository: `IbrahimMohamed101/client_dashbourd`

Location:
**المحاسبة → تحليلات التسويق**

Dashboard PR:
- #49 — `feat: marketing analytics dashboard`
- Merged commit: `eddce6906a6fbe26d7d6adfdfc55e9d42cf56252`

UI includes:
- period presets/custom dates,
- commercial segment filters,
- KPI cards,
- funnel,
- checkout/payment quality,
- revenue channel breakdown,
- promo table,
- plan table,
- fulfillment/payment-provider breakdown,
- daily series,
- comparison with previous period.

## Metric definitions

Registrations:
- non-merged users with role `client` created in period.

Logged-in users:
- client accounts with `lastLoginAt` in period.
- This is not app-session/screen analytics.

Checkout:
- based on `CheckoutDraft`.

Paid app customers/revenue:
- paid subscription-related payments linked to CheckoutDraft.

First-time subscribers:
- paid customers whose earliest paid subscription-related Payment across full history occurs in current period.

Repeat paid customers:
- paid customers minus first-time paid customers for the period.

Revenue sources:
- app: payment linked to checkout draft,
- dashboard: cash/manual or dashboard source,
- other: remaining paid subscription sources.

Promo analytics:
- based on `PromoUsage` joined to payments.
- "usage records" should not be misrepresented as mere code-entry attempts.

## Important limitations

1. No accurate install/first_open metric from this server-only layer.
2. No complete Meta/Google/TikTok source-to-revenue attribution yet.
3. Logged-in metric is based on `lastLoginAt`.
4. Segment filters are most meaningful for checkout/app-sales funnel; registrations/logins and all-channel revenue may remain period-wide.
5. If exact self-registration is required, admin-created client semantics should be separately validated/refined.

## Verification

Feature-specific backend tests and syntax checks passed before merge.
Dashboard typecheck/build and accounting-focused checks passed before merge.
Production Railway backend and dashboard deployments were verified healthy after merge.
