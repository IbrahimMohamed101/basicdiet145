# Approved conversion improvements — 2026-11-24

Scope: first website-only increment on the production landing branch's exact base. Not released.

Existing systems identified: first-party landing analytics with session and UTM attribution, separate Meta Pixel consent, backend read-only marketing analytics (first-time versus repeat paid customers). The current website already requires service-contact consent and already shows app-store links after lead success. The discount is a callback offer subject to confirmation, not a promised automatically applied coupon.

Changes in this increment: explicit hero calculator CTA, server-rendered calculator shell using the same live catalog, estimated package-only per-meal price and savings, catalog outage link, calculator store-click tracking through the existing event contract, prominent offer terms before the submit button. Tests added for these behaviors. Existing payment/checkout paths are untouched.

Release gates still open: retrieve live dated baseline from authorized dashboard; verify actual payment application and activation criteria; design a safe cross-device attribution handoff (do not equate store clicks with installs); run full build/browser QA and inspect mobile screenshots; confirm WhatsApp number, official address/hours, current nutrition source and testimonials before publishing; confirm offer eligibility and opt-out process. No external tracking SDKs added. No conversion uplift claimed.

## Review fixes

Restored deferred JavaScript with a server-rendered shell and explicit hash activation after actual CI found an eager-load regression. Updated old CTA and nutrition label assertions without changing business data. Added regression coverage for hero navigation, catalog-derived arithmetic, one event per store click, and mobile screenshots. Required landing gate now runs conversion tests; same-runner baseline/candidate lab comparison captures LCP, initial JS and Event Timing (not field INP). Live BASIC15 eligibility was not reachable; approved website callback offer remains explicitly conditional rather than exposing an unverified code. Separate backend PR #252 derives completed paid conversions from payment/draft records; store-only cross-device attribution is not assumed.
