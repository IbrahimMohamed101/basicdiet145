# Basic Diet Marketing State

**State version:** v2  
**Last updated:** 2026-10-28  
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


## Website production release — 2026-10-28

The food-first home/menu and 15% website callback offer are now LIVE on https://basicdietksa.com/ and /menu. The user explicitly authorized production publication. Registration requires name, Saudi mobile and contact consent; choosing a package is optional. No coupon entry or payment is required. The offer applies only to the package subtotal; staff confirms eligibility and final price.

Release evidence:
- Backend PR #174: merge fa5c3e4e74bc571ee53ab7fd0fd2a5ce0cea1285, Railway 89fdceeb-64a9-4168-a955-1624cd0046b1 SUCCESS; health/database up.
- Dashboard IbrahimMohamed101/client_dashbourd#61: merge 1de7b3ff9fb4240ef9382625f9f4c346c111b656, Railway 5e911ae5-7d5e-4cd4-8df9-70795b57cdd0 SUCCESS.
- Website PR #175: merge 1ea3e206695c804993e28873f5c0d137a87985b0, Railway c16b8818-7195-43e8-94d2-95efac1006cd SUCCESS.
- Release browser suites passed (56 menu/offer/integration checks; 15 lead/SEO/origin checks, with some overlap). Production lead/SEO/origin build workflow 40694877782 also passed. Backend real HTTP-to-ephemeral-Mongo-to-dashboard-read integration and dashboard five targeted tests passed.
- Production HTTP home/menu/catalog are 200; catalog provides three plan durations. Browser verified the direct registration dialog, live calculator savings and canonical menu navigation.
- Same-origin production intake rejects empty JSON with 400 and accepts an explicit no-plan smoke request with 202. The smoke request populated the honeypot so it did NOT persist a fake contact or send any message. Production authenticated dashboard display/new-customer persistence was not simulated.

Measurement remains a hypothesis until live results exist: count unique saved inquiries separately from browser completion signals and verified paid subscriptions. No conversion lift, ad campaign, new subscriber or revenue result is claimed. Preview remains isolated with real intake disabled. The historical full visual suite still includes older pre-calculator layout expectations; its results must not be represented as the maintained release suite.
