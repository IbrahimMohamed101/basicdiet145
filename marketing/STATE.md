# Basic Diet Marketing State

**State version:** v2  
**Last updated:** 2026-10-07  
**Status:** Core data foundation complete enough for daily organic content execution. Live commercial baseline remains the main measurement gap.

## North Star

Increase **first-time paid subscribers**, then improve retention/repeat subscriptions and profitable revenue.

Vanity metrics such as views and likes are secondary unless they demonstrably support the commercial funnel.

## Current phase

**Phase 2 — Daily content readiness + live learning**

Completed:
- Product/package/pricing context gathered.
- Drive asset library reviewed at folder/file level.
- Menu/product data reviewed with many verified item names, prices and nutrition fields.
- Initial positioning established.
- Initial content pillars established.
- Read-only Marketing Analytics backend endpoint implemented.
- Marketing Analytics dashboard UI implemented.
- Repository-based Marketing OS protocol established.
- Initial public Voice of Customer research completed.
- Initial competitor/market scan completed.
- Public store/listing signals reviewed.
- 30-item grounded content backlog created for daily execution.

Open:
1. Pull and save a dated 30/60/90-day live Marketing Analytics baseline.
2. Expand VOC with private/internal sources: WhatsApp, support, cancellations, checkout objections, repeat-customer feedback.
3. Start publishing and logging daily content.
4. Build the first weekly learning loop after enough posts/results exist.
5. Improve source/campaign attribution before scaling paid ads.

## Content readiness decision

**Organic daily content can start now.**

The missing 30/60/90 commercial baseline is important for measurement and paid scaling, but it is not a blocker for starting disciplined organic publishing because product facts, assets, positioning, public VOC, competitor context and a content backlog now exist.

## Current positioning

> **Basic Diet = أكل حقيقي تحبه، بكميات محسوبة، بخيارات كثيرة، ويوفر عليك قرار الأكل كل يوم.**

Core message pillars:
- **الطعم**
- **الاختيار**
- **الراحة**

Supporting proof/value:
- ingredients,
- calories/macros where verified,
- portion options,
- menu variety,
- subscription convenience,
- cleanliness/quality/taste proof,
- real customer language.

## Evidence update

Initial public review mining supports three themes:
1. Taste is a real positive signal.
2. Cleanliness/quality appears in public customer language.
3. At least one public reviewer described moving from trying the meals to joining a subscription.

A recurring high-value phrase/theme is the idea of enjoying familiar/crispy food **without feeling guilty**. Treat this as an early signal, not a universal customer truth.

## Competitive context

Strong competitors/benchmarks commonly emphasize:
- personalized plans,
- calorie/macronutrient control,
- goal-based packages,
- dietitian/clinical authority,
- free/convenient delivery,
- large menu variety,
- promotional pricing.

Basic Diet should avoid competing only on generic "healthy meals" or discount percentage. The stronger creative territory is:
**familiar desirable food + measured portions/macros + flexibility + convenience**.

## Current content mix — starting hypothesis

- 30% Food Desire
- 20% Education
- 20% Lifestyle / Problem
- 15% Trust / Proof
- 15% Conversion / Offer

These are starting weights, not permanent rules. Adjust from measured performance.

## Current commercial context

Known plan durations:
- 7 days
- 26 days
- 30 days

Portion options:
- 100g
- 150g
- 200g

Meals/day:
- 1–5

Fulfillment:
- Delivery
- Pickup

Promos currently central to marketing context:
- `KSA96` — 30%
- `BASIC15` — 15%

Discount strategy rule:
- Promo-driven posts must not dominate the brand.
- Build desire, trust, convenience and product value first; use promo as a conversion tool.
- Current application rule in product system: promo discount applies to package subtotal, not delivery or daily add-ons.

## Measurement status

Available now:
- registrations
- logged-in users based on existing `lastLoginAt`
- checkout starts/users
- paid transactions/customers
- first-time paid subscribers
- repeat paid customers
- registration-to-paid conversion
- checkout-to-paid conversion
- app revenue
- total subscription revenue by source
- AOV
- checkout state quality
- failed payments
- cancellations
- promo performance
- plan performance
- fulfillment performance
- payment-provider performance
- daily series
- previous-period comparisons

Still not captured as a repository snapshot:
- current 30-day baseline
- current 60-day baseline
- current 90-day baseline

Not fully instrumented:
- installs / first_open
- complete source-to-purchase attribution
- reliable channel CAC
- ROAS by campaign/creative
- historical social creative performance corpus

## Known data-quality boundaries

- "Logged in" means server-side `lastLoginAt`, not session/screen activity analytics.
- App install counts are not inferred from backend registrations.
- Segment filters on the Marketing Analytics endpoint apply primarily to Checkout/app-sales funnel metrics; period-wide registration/login and all-channel revenue metrics have different scope.
- Current user-registration metric is all non-merged client accounts created in period; self-registration vs admin-created client semantics may need a dedicated refinement if required.

## User protocol

When the user says:

> **Basic Diet Mode**

Use this repository Marketing OS as the source of truth before answering.

For "ننزل إيه النهارده؟":
1. read `marketing/content/backlog.md`,
2. check `marketing/content/content-log.md`,
3. check current offer/state,
4. prefer an unused grounded idea,
5. adapt it to the strongest available asset,
6. define one primary KPI,
7. document the result after publishing.
