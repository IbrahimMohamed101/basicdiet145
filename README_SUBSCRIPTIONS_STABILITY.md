# Subscriptions API Stability & Compatibility

This document outlines the API stability guarantees for the core subscription endpoints in `basicdiet145`.

## Stable Endpoints (Canonical)
These endpoints reflect the finalized Phase 1 & 2 architecture and are safe for long-term client consumption:
- `GET /api/subscriptions/menu`
- `POST /api/subscriptions/quote`
- `POST /api/subscriptions/drafts`
- `GET /api/subscriptions/drafts/:id`
- `POST /api/subscriptions/drafts/:id/checkout`
- `GET /api/subscriptions/:id`
- `GET /api/subscriptions/:id/days`
- `POST /api/subscriptions/:id/days/:date/confirm`
- `GET /api/subscriptions/:id/renewal-seed`

## Internal / Admin Only
These endpoints are not intended for customer clients and carry weaker compatibility guarantees if operational needs change:
- `POST /api/admin/subscriptions`
- `POST /api/admin/subscriptions/:id/cancel`
- `PUT /api/admin/subscriptions/:id/extend`
- *Other `adminController` routes*

## Feature-Flag Conditional Fields
Some fields are conditionally exposed depending on Phase 2 flags:
- `planningVersion`, `planningState`, `baseMealSlots` on days require `PHASE2_CANONICAL_DAY_PLANNING`.
- `premiumWalletMode` set to `generic_v1` requires `PHASE2_GENERIC_PREMIUM_WALLET`. Keep treating legacy `premiumRemaining` as the compatibility fallback.

## Deprecated / Legacy Behaviors (Sunset Track)
- Direct purchase of `premiumItems` during checkout without generic credits.
- Modifying days purely via legacy `meals` array mutations after confirmation rather than `baseMealSlots`.
