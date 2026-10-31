# Basic Diet Search Visibility — implementation review (2026-10-31)

Status: **proposed in a review branch; NOT published to production yet**.
Source branch for live website: `landing-page-research`, not repository default `main`.
Production Railway service: `basicdiet-landing`; last observed SUCCESS 2026-10-28 at commit `391618be559054de398cc3ddfc7b8ea9a9dd5b68`.

## Verified issues
- Homepage subscription price calculator begins with loading text; values are populated client-side.
- Search-intent Jeddah page used Egyptian dialect and lacked a server-rendered price comparison.
- Restaurant JSON-LD advertised 24/7 opening hours without independently verified business hours.
- Page previously used a butter-chicken graphic even though that dish was flagged as unavailable.
- `/menu` is in the sitemap but Search Console indexing status is an external follow-up, not something a code commit can guarantee.
- Google Business Profile, PageSpeed Insights and live Search Console indexing requests are not controlled through GitHub/Railway.

## Proposed work
- Dynamic server-rendered examples on homepage and detailed Jeddah prices page, reading validated published app plan prices from `/api/plans` with 15-minute fetch cache. On source failure, show no fabricated amount.
- Saudi/neutral Arabic for Jeddah intent page and pricing links in Footer and cross-page navigation.
- Sitemap includes new canonical URL and honest, explicitly recorded content modification dates.
- Strip unverified 24-hour hours from schema/footer, keep verified contact and map URLs, link menu through `hasMenu`.
- Replace unsupported butter-chicken promotional illustrations with the existing salmon asset; enrich FAQ answers without FAQ rich result promises.
- Playwright regression coverage for canonical, sitemap, SSR markup and no 24-hour structured-data claim.

## Release checks
1. PR CI: TypeScript typecheck, Next build and SEO/lead-flow Playwright checks.
2. Verify the actual `/api/plans` live data yields prices for each active duration, portions and meal counts; compare displayed totals to cashier and app.
3. Check mobile width, pricing table layout, lead contact form and 15% conditions.
4. After approved merge/deploy, check production URLs return 200 with correct canonical, server HTML prices (or explicit unavailable state), sitemap entries, and JSON-LD.
5. Use Search Console URL Inspection for `/menu` and new pricing page; submit indexing requests where eligible. Re-submit sitemap only after deployment.
6. Verify Google Business Profile opening hours, contact, service area and review link from business owner; then align on-site opening hours. No unverified hours or neighborhood-specific service pages.
7. PageSpeed Insights mobile diagnostic and image optimization remain separate performance verification work; no Core Web Vitals outcome asserted.

## Measurement protocol
Measure GSC at country=Saudi Arabia, segment brand/non-brand queries, monitor weekly impressions/clicks/CTR/rank by page and first-time paid subscriptions. Previous report figures are user-supplied Oct 11–29 snapshot, not independently fetched in this change. No ranking or conversion improvement claimed prior to release and measurement.
