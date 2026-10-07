# Landing Page Implementation

**Current status: V1 IMPLEMENTED + CI/RESPONSIVE QA PASSED**

Source:
`landing-page/site/`

## Implemented

- [x] Next.js App Router scaffold
- [x] TypeScript
- [x] Tailwind CSS
- [x] Tajawal Arabic typography
- [x] RTL
- [x] design tokens
- [x] Header
- [x] Hero
- [x] approved Hero Video v1 wired
- [x] proof strip
- [x] real Basic Diet meal gallery
- [x] tagline reveal
- [x] benefits
- [x] how it works
- [x] official App Store screenshot showcase
- [x] plans
- [x] grounded quality proof
- [x] accessible FAQ
- [x] final CTA
- [x] footer
- [x] SEO metadata
- [x] FAQ + Restaurant JSON-LD
- [x] CTA analytics hooks
- [x] UTM capture hooks
- [x] responsive rules
- [x] reduced-motion handling
- [x] CI build/typecheck
- [x] Playwright visual QA

## Vendored assets

Local project assets now include:
- canonical Basic Diet primary logo
- white Basic Diet logo
- real butter-chicken image
- real salmon image
- real Basic Diet salad image

This avoids relying on Google Drive hotlinks in the page.

## Responsive QA

Final automated PASS:
- 1440px desktop
- 390px mobile
- 320px narrow mobile

Workflow:
https://github.com/IbrahimMohamed101/basicdiet145/actions/runs/37561914192

## CTA destinations

Verified:
- iOS: https://apps.apple.com/ar/app/basic-diet/id6775085745

Pending:
- Android public destination

Environment:
- `NEXT_PUBLIC_IOS_APP_URL`
- `NEXT_PUBLIC_ANDROID_APP_URL`
- `NEXT_PUBLIC_SITE_URL`
- optional hero media override URLs

## Remaining launch work

- [ ] verified Android destination
- [ ] public site/domain deployment
- [ ] final canonical site URL
- [ ] real-device iOS Safari QA
- [ ] real-device Android Chrome QA
- [ ] final Lighthouse/Core Web Vitals check on deployed URL
- [ ] launch-time proof/rating refresh if displayed

Do not add fabricated reviews, ratings, delivery coverage, prices or Android store URLs.
