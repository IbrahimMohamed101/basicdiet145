# Meta Ads and Basic Diet landing: dev handoff — 2026-10-29

## Scope and status

Development-only implementation on branch fix/meta-landing-tracking-20261029 (based on landing-page-research). No Production deployment or live Meta campaign edits.

## Implemented
- Disabled-by-default, consent-gated Meta Pixel component (components/MetaPixel.tsx).
- Separate opt-in for advertising measurement, independent from contact and marketing-message consent.
- Respect for Do-Not-Track and Global Privacy Control. No Meta script loads until explicit opt-in.
- Consent withdrawal settings accessible from /privacy.
- PageView on allowed route views; Lead only following the successful lead form response using requestId as eventID.
- Existing website analytics, session and UTM storage remain unchanged.
- Playwright regression test for attribution persistence from / to /menu and requestId propagation.

## Configuration — do not activate without approval
- NEXT_PUBLIC_META_PIXEL_ENABLED=false is the default.
- NEXT_PUBLIC_META_PIXEL_ID= must be an authorized numeric Pixel ID. No ID is hardcoded.
- These are build-time Next.js values. A new build is needed to enable them.
- Never put server Meta access tokens in NEXT_PUBLIC_* environment variables.

## Known limitations and release prerequisites
1. Confirm Meta Business access and verify the correct Dataset/Pixel ID.
2. Companion backend PR #179 now proposes a disabled-by-default consent-only CAPI outbox and retry worker. It is NOT merged or deployed, and real Pixel/CAPI deduplication remains untested pending Meta Business access.
3. HTTP 202 may intentionally cover duplicate and honeypot submissions. Browser Lead represents an accepted form response, not proof of new database insertion. Backend PR #179 queues CAPI only after a new durably persisted lead; browser-only duplicate conversion cases need QA and reporting semantics review.
4. Existing running ads have no UTM parameters; nothing in this branch can backfill them. New advertisements need tagged destinations after separate Meta approval.
5. Obtain privacy/legal approval for optional advertising measurement and third-party data transmission under applicable Saudi requirements.

## Test checklist
- With flag disabled: no fbevents.js, no Meta browser requests.
- With flag enabled but consent unknown/denied: no third-party script.
- With consent granted: PageView and one Lead per accepted requestId.
- Withdrawal from /privacy: removes loaded Pixel through full page reload.
- Failed 400/429/503 lead submissions: no Lead event.
- Navigate from UTM-tagged / to /menu: lead retains UTM.
- Later, with an isolated test Pixel and CAPI, test deduplication in Events Manager using synthetic data.

## Split of responsibilities

Claude / Meta owner: resolve Business access, identify the right Dataset ID and Pixel ID, prepare CAPI token provisioning, verify account restrictions, and prepare Jeddah-Instagram targeting suggestions. Make no site code edits, no Meta budget changes, and no Production changes.

Site engineer: implements frontend/backend event and attribution code, consent flows, future CAPI integration, tests and secure staging QA. Do not enable Pixel in Production before owner approval.

## Release safety
Production Railway currently uses branch landing-page-research. This fix branch is separate and no site deployment was performed. Production merge, configuration and Meta enablement need explicit approval.
