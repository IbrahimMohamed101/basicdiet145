# Approved conversion improvements — 2026-11-24

Scope: first website-only increment on the production landing branch's exact base. Not released.

Existing systems identified: first-party landing analytics with session and UTM attribution, separate Meta Pixel consent, backend read-only marketing analytics (first-time versus repeat paid customers). The current website already requires service-contact consent and already shows app-store links after lead success. The discount is a callback offer subject to confirmation, not a promised automatically applied coupon.

Changes in this increment: explicit hero calculator CTA, server-rendered calculator shell using the same live catalog, estimated package-only per-meal price and savings, catalog outage link, calculator store-click tracking through the existing event contract, prominent offer terms before the submit button. Tests added for these behaviors. Existing payment/checkout paths are untouched.

Release gates still open: retrieve live dated baseline from authorized dashboard; verify actual payment application and activation criteria; design a safe cross-device attribution handoff (do not equate store clicks with installs); run full build/browser QA and inspect mobile screenshots; confirm WhatsApp number, official address/hours, current nutrition source and testimonials before publishing; confirm offer eligibility and opt-out process. No external tracking SDKs added. No conversion uplift claimed.
