# Landing page → Backend analytics

The **website** deploys from basicdiet145/landing-page-research and the **API** deploys
from basicdiet145/main. A separate GitHub PR is needed for each branch.

## Production contract

- Browser POSTs to same-origin **/api/analytics** (Next.js API route).
- Next forwards to **POST /api/landing-analytics/events**, with
  server-only x-landing-analytics-key and a 4-second timeout.
- Express validates the shared secret in constant time, limits ingestion, whitelists event names
  and fields, and stores in MongoDB collection landinganalyticsevents.
- Replays of the same eventId are idempotent. MongoDB TTL removes events after 180 days.
- **GET /api/landing-analytics/report?from=YYYY-MM-DD&to=YYYY-MM-DD**
  requires dashboard Bearer JWT for the admin/superadmin role.
- **GET /api/marketing-agent/landing-report?from=...&to=...**
  is read-only and requires the existing GitHub OIDC authentication, capped at 90 days.
- Dates and daily aggregates use Asia/Riyadh.

## Railway settings

Set the same random **LANDING_ANALYTICS_INGEST_SECRET** on both the backend
and landing service (never NEXT_PUBLIC_). On the landing service set
**LANDING_ANALYTICS_BACKEND_URL** to https://basicdiet145-production-51e9.up.railway.app .
Backend needs no new CORS origin because the Next.js proxy communicates server-to-server.

## Metrics

Events: lp_view, lp_section_view, lp_cta_click, lp_store_click, lp_nav_click,
lp_faq_open, lp_reel_click. The dashboard shows page views, tab-scoped session IDs,
CTA/store intents, trends, UTM sources, campaigns, location, device and referrer host.

An app-store click **does not prove** installation, registration, or payment.
Attribution to a new paid subscription requires a separate app/deep-link identity handoff
and payment reconciliation. No customer records, raw IP, names, phone, email, or full
referrer URLs are stored. There is no historical backfill. Respect browser Do Not Track.
Some blockers/bots/private browser modes mean counts are approximate.

## Verification

1. Run **node tests/landingAnalytics.test.js** in the backend repository.
2. Deploy both branches and ensure secrets match.
3. In a test browser visit the landing page and click a store link.
4. Confirm the page's POST /api/analytics returns HTTP 204.
5. In the authenticated dashboard, open **المحاسبة > تحليلات التسويق** and
   inspect the landing analytics section. Ingestion should produce a page view
   and CTA/store click; the source should show UTM values where provided.
6. Confirm unauthenticated GET /api/landing-analytics/report is blocked and
   unauthenticated POST /api/landing-analytics/events returns 401.
