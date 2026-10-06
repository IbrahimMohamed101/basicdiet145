# Marketing Measurement Framework

**Version:** v1  
**Last updated:** 2026-10-07

## North Star metric

**First-time paid subscribers**

## Core funnel

`Awareness -> Visit/Open -> Registration -> Checkout -> Paid -> Repeat`

Current backend analytics starts reliably at server-observable registration/checkout/payment stages. Install/first-open and full channel attribution remain incomplete.

## Core business KPIs

### Acquisition / activation
- new registrations
- checkout users
- checkout starts
- first-time paid subscribers
- Register -> Paid conversion
- Checkout -> Paid conversion

### Revenue
- paid customers
- paid transactions
- app revenue
- all-channel subscription revenue
- AOV

### Retention
- repeat paid customers
- cancellations
- renewal/repeat behavior where available

### Funnel quality
- pending checkouts
- failed/cancelled/expired checkout outcomes
- failed payments

### Commercial segmentation
- plan duration
- grams
- meals/day
- promo
- fulfillment
- payment provider

## Content metrics hierarchy

### Primary — when attribution is available
- registrations attributed
- checkout users attributed
- first paid subscribers attributed
- revenue attributed
- CAC
- ROAS

### Secondary
- profile visits / landing visits
- CTA clicks
- saves/shares/comments
- qualified inbound questions

### Diagnostic only
- views
- reach
- likes

High reach is not automatically success.

## Snapshot protocol

When a number materially informs a decision:
1. Pull from live analytics.
2. Record date/time and filters.
3. Store aggregate values only.
4. Save under `analytics/snapshots/YYYY-MM-DD-<scope>.md`.
5. Never silently overwrite an old snapshot.

## Attribution future state

Ad/content naming should eventually preserve:
- source,
- medium,
- campaign,
- creative/content,
- offer,
- conversion,
- revenue.

Use consistent UTM/campaign naming once external links/landing pages are part of execution.
