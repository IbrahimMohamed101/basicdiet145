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

## Final technical audit (2026-10-09)

Scope: existing Hero, Plans and Benefits ("الاشتراك على مقاسك") buttons; responsive
dialog; backend catalog/lead intake; role-gated dashboard inbox; aggregate analytics.
The Benefits CTA preserves grams, meals/day, and pickup/delivery preference; final
selection is validated again against a real sellable plan on the server.

- Backend lead security tests: PASS in GitHub Actions workflow `Landing lead security contracts`,
  PR #150 (checks also cover disabled meal options in the public catalog).
- Landing browser tests: 4 PASS in GitHub Actions workflow `Landing page build`,
  PR #151. Scenarios: Benefits selected 200g/5/pickup -> accepted mocked POST with
  consent; mobile 7-day bottom sheet positioning; catalog offline fallback; privacy
  notice link. These are mocked end-to-end UI tests, **not a production PII submission**.
- Dashboard production build and role regression: PR #53. The `admin` role route
  was missing in navigation and is now explicitly included along with
  `superadmin` and `restaurant`; kitchen, courier and cashier remain denied.
- `/privacy` is a dedicated Arabic landing consent notice; the existing backend
  `/privacy-policy` continues to govern the mobile app.
- Marketing Analytics now includes **uniqueLeads** counted from real saved MongoDB
  lead documents within the selected interval, not anonymous repeat browser events.
- Railway HTTP proxy logs showed five 2xx responses for public /api/lead-options
  and backend /api/landing/options in the 24-hour review window, zero 5xx on those
  paths. No /api/leads POST appeared in that window.

### Explicit remaining acceptance (requires an authorized real test phone)
The site has not been confirmed with a production lead submission via the browser
and a dashboard operator opening/updating the resulting record. Do not send test
customer PII without the owner's authorization. Once the customer-service team
completes this step, record the test time, source UTM, and anonymized request ID
here. Do not log the full phone number.

### Measurement boundaries
A `202` may refer to a same-day deduplicated lead; therefore count unique saved
leads through `uniqueLeads`, not just `lp_lead_submitted`.
A lead is **not** a completed Flutter registration, installed app, or payment.
Any dashboard `converted` status remains an operator tag until reconciled against
real paid subscriptions.
