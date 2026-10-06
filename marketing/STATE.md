# Basic Diet Marketing State

**State version:** v1  
**Last updated:** 2026-10-07  
**Status:** Foundation built; execution system being established.

## North Star

Increase **first-time paid subscribers**, then improve retention/repeat subscriptions and profitable revenue.

Vanity metrics such as views and likes are secondary unless they demonstrably support the commercial funnel.

## Current phase

**Phase 1 — Marketing foundation + baseline + execution system**

Completed:
- Product/package/pricing context gathered.
- Drive asset library reviewed at folder/file level.
- Initial positioning established.
- Initial content pillars established.
- Read-only Marketing Analytics backend endpoint implemented.
- Marketing Analytics dashboard UI implemented.
- Repository-based Marketing OS protocol established.

Next:
1. Capture a dated 30/60/90-day baseline from Marketing Analytics.
2. Build Voice of Customer (VOC) from real reviews, messages, support questions, cancellation reasons, and objections.
3. Build structured competitor profiles for the most relevant Jeddah meal-subscription competitors.
4. Finalize the first 90-day marketing plan.
5. Start daily/weekly content execution and content performance logging.
6. Before scaling paid ads, improve source/campaign attribution and establish CAC/ROAS reporting.

## Current positioning

> **Basic Diet = أكل حقيقي تحبه، بكميات محسوبة، بخيارات كثيرة، ويوفر عليك قرار الأكل كل يوم.**

Core message pillars:
- **الطعم**
- **الاختيار**
- **الراحة**

Supporting proof/value:
- ingredients,
- calories/macros where available,
- portion options,
- menu variety,
- subscription convenience,
- trust/social proof.

### Strategic angle under evaluation

**Familiar / Saudi food made compatible with a measured healthy routine** is a promising differentiation angle, but it remains a hypothesis until validated through content/campaign data and VOC.

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
- Build desire, trust, convenience, and product value first; use promo as a conversion tool.
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

Not fully available yet:
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

For "ننزل إيه النهارده؟", do not return a random idea. Ground the recommendation in current goal, recent content, assets, offer, analytics, VOC/learning, and funnel stage.
