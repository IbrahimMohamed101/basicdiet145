# Marketing Experiments

Experiments separate assumptions from learned facts.

## Status values
- Proposed
- Approved
- Running
- Complete
- Stopped

## Experiment template

### EXP-XXX — Title

**Status:** Proposed  
**Created:** YYYY-MM-DD  
**Owner/objective:**  
**Hypothesis:**  
**Evidence behind hypothesis:**  
**Audience:**  
**Control:**  
**Variant:**  
**Primary metric:**  
**Secondary metrics:**  
**Guardrail metric:**  
**Start condition:**  
**Stop/decision rule:**  
**Result:** Pending  
**Learning:** Pending  
**Decision after test:** Pending

---

### EXP-001 — Familiar-food positioning vs generic healthy-language

**Status:** Proposed  
**Created:** 2026-10-07  
**Objective:** Test whether familiar-food creative creates stronger commercial intent than generic healthy-lifestyle messaging.

**Hypothesis:** Creative centered on familiar meals (for example Saudi/familiar dishes) will generate stronger checkout intent than generic "healthy lifestyle" copy because it reduces the perceived taste/sacrifice cost of dieting.

**Evidence behind hypothesis:** Basic Diet has broad familiar-menu assets and nutrition/product structure. This is strategic reasoning, not yet customer-proven VOC.

**Primary metric:** Checkout-to-paid and/or first-paid-subscriber rate when attribution is available.  
**Secondary:** qualified landing/profile visits and checkout starts.  
**Guardrail:** do not use unsupported nutrition/weight-loss claims.

**Result:** Pending.


## 2026-10-28 — Website registration offer (preview)

Hypothesis: food-first browsing, a consistent “سجّل لخصم 15%” CTA, expected SAR savings and an instant no-plan registration form improve completed callback requests. This is a hypothesis, not a measured conversion lift.

Audience: Jeddah visitors interested in meals who may not have selected a subscription. Offer stays 15% on package subtotal only, excluding individual meals, delivery and add-ons. No customer-facing coupon, invented urgency, testimonials or nutrition claims. Eligibility is confirmed by staff; additional eligibility exclusions have not been supplied and must not be invented.

Primary measurement: unique saved callback leads. Diagnostic measurements: `lp_lead_opened`, accepted form completions and placement. Leads are not paid subscriptions. Unselected inquiries have null plan dimensions and are excluded from plan-choice buckets.

Implementation: canonical menu photos/prices on home, consistent CTAs, final registration CTA, Arabic-digit phone support, price-outage fallback, stale-response guard. Backend PR #174 and dashboard PR #61 are paired compatibility changes. Preview intake remains disabled on client and server.

Validation: Next.js 16.4.3 build passed; backend lead/attribution unit contracts passed. Local MongoDB startup and Playwright download are unavailable in this execution environment; real persistence and responsive checks are included in CI. No live lead data, production deployment or campaign spend used. Results pending; no conversion uplift claimed.
