# Basic Diet Search Visibility — implementation review (2026-10-31)

Status: **proposed in a review branch; NOT published to production yet**.
Source branch for live website: `landing-page-research`, not repository default `main`.
Production Railway service: `basicdiet-landing`; last observed SUCCESS 2026-10-28 at commit `391618be559054de398cc3ddfc7b8ea9a9dd5b68`.

## Verified issues
- Homepage subscription price calculator begins with loading text; values are populated client-side.
- Search-intent Jeddah page used Egyptian dialect and lacked a server-rendered price comparison.
- The original restaurant hours were cross-checked against the public local business listing (24 hours each day), so the schedule is kept, with a holiday-hours reminder in the footer.
- Page previously used a butter-chicken graphic even though that dish was flagged as unavailable.
- `/menu` is in the sitemap but Search Console indexing status is an external follow-up, not something a code commit can guarantee.
- Google Business Profile, PageSpeed Insights and live Search Console indexing requests are not controlled through GitHub/Railway.

## Proposed work
- Dynamic server-rendered examples on homepage and detailed Jeddah prices page, reading validated published app plan prices from `/api/plans` with 15-minute fetch cache. On source failure, show no fabricated amount.
- Saudi/neutral Arabic for Jeddah intent page and pricing links in Footer and cross-page navigation.
- Sitemap includes new canonical URL and honest, explicitly recorded content modification dates.
- Preserve mapped 24-hour schedule, plus-code address, and current business contact and map URLs in Restaurant JSON-LD; add the menu URL via `hasMenu`.
- Replace unsupported butter-chicken promotional illustrations with the existing salmon asset; enrich FAQ answers without FAQ rich result promises.
- Playwright regression coverage for canonical, sitemap, SSR markup and schedule matching the local listing.

## Release checks
1. PR CI: TypeScript typecheck, Next build and SEO/lead-flow Playwright checks.
2. Verify the actual `/api/plans` live data yields prices for each active duration, portions and meal counts; compare displayed totals to cashier and app.
3. Check mobile width, pricing table layout, lead contact form and 15% conditions.
4. After approved merge/deploy, check production URLs return 200 with correct canonical, server HTML prices (or explicit unavailable state), sitemap entries, and JSON-LD.
5. Use Search Console URL Inspection for `/menu` and new pricing page; submit indexing requests where eligible. Re-submit sitemap only after deployment.
6. Verify Google Business Profile opening hours, contact, service area and review link from business owner; the public listing currently gives 24-hour daily hours, which match the on-site structured data. Avoid false neighborhood-specific pages.
7. PageSpeed Insights mobile diagnostic and image optimization remain separate performance verification work; no Core Web Vitals outcome asserted.

## Measurement protocol
Measure GSC at country=Saudi Arabia, segment brand/non-brand queries, monitor weekly impressions/clicks/CTR/rank by page and first-time paid subscriptions. Previous report figures are user-supplied Oct 11–29 snapshot, not independently fetched in this change. No ranking or conversion improvement claimed prior to release and measurement.

## Menu QA resolution

- The 36 `/menu-images/pos_*.webp` references are not missing in production. The source file `assets/menu-photos/pack-01..04.b64` includes an immutable checksum-verified archive; `scripts/extract-menu-photos.mjs` unpacks 36 WebP photos into `public/menu-images/` as part of `npm run build`. The earlier file-tree-only inspection was insufficient.
- Source code keeps all 36 original image references and `illustrativeImage` truth labels. No product photographs were replaced with synthetic art.
- Corrected the stale Playwright assertion to require exactly 36 `/menu-images/pos_` references and zero static `/api/menu-art` references; dynamic illustration endpoint remains a fallback for runtime load failures.
- The salmon 200g base POS price remains 59 SAR; test now accepts western/Arabic numeral display.

## 2026-10-31 addendum: server rendering
The production pages `/` and `/jeddah/subscription-prices` explicitly use dynamic server rendering, to avoid freezing a build-time empty-price fallback. The homepage wraps the server pricing fragment in Suspense for a fast initial response; the public fetch remains read-only with a maximum 15-minute revalidation window. Confirm full HTML output and production first-byte timing after release.
