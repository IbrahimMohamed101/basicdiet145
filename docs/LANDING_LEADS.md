# Basic Diet landing lead capture (2026-10-09)

## Flow and UX
Existing CTA buttons -> a closed-by-default native dialog on desktop / bottom sheet on mobile.
Step 1 uses live GET /api/landing/options (sellable 7/26/30-day package options from MongoDB; no guessed pricing).
Step 2 collects optional name, required Saudi mobile, affirmative service-contact consent,
and independent optional future-marketing consent.
Server verifies selected plan/grams/meals against the current sellable catalogue.
Success shows app stores; the site layout remains untouched when the sheet is closed.

## Endpoints
- GET /api/landing/options: public safe catalog (only plan IDs, days, active grams and meal counts).
- POST /api/landing/leads: secret-protected **server-to-server** Next proxy, 202 generic response.
- GET /api/dashboard/landing-leads?status=all&page=1: admin, superadmin, restaurant; 25 per page.
- PATCH /api/dashboard/landing-leads/:id: admin, superadmin, restaurant; status and staff note only.
- Next /api/lead-options and /api/leads call the backend; no secret is shipped in browser JS.

Shared secret already exists on both Railway services as LANDING_ANALYTICS_INGEST_SECRET;
LANDING_ANALYTICS_BACKEND_URL already points to the production backend.
No new Railway variable is needed. No raw customer details enter the marketing agent.
Lead records stay only in restricted CRM; campaign/source can support aggregate evaluation.

## Privacy and quality
- Strict Saudi mobile normalization, live plan membership, mandatory contact consent.
- Marketing consent is optional and false by default; do not send promotions without it.
- Daily phone HMAC dedupe and idempotent requestId; bot honeypot; ingress rate limiter.
- No raw IP, device fingerprints or full URL are stored on a lead.
- Lead records have a 180-day MongoDB TTL; access is dashboard JWT role-gated.
- Marking "converted" is an **operator's manual tag**, not payment reconciliation.
- The anonymous lp_lead_submitted tracking event has no phone/name/email.

## Production acceptance
1. Confirm PR and CI/test pass: npm run test:landing-leads, landing site Next build/typecheck,
   dashboard TypeScript build.
2. Verify backend, dashboard then site Railway deployments are healthy.
3. Open landing on Android, iOS and desktop, click hero and plans CTAs, close via Esc/backdrop.
4. Submit **one** authorized test phone with consent, then find it on dashboard landing leads.
5. Reuse same phone same day: no duplicate lead should be persisted.
6. Update status and staff note with admin role; verify unauthenticated reads return 401.
7. Verify UTM campaign/source appears and app-store buttons still open independently.

The site does not create a registered Flutter account, place a real paid order, send WhatsApp
messages automatically, or promise app-install/payment attribution.
