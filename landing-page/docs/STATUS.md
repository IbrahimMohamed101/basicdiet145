# Basic Diet Landing Page — STATUS

**Last updated:** 2026-10-07  
**Branch:** `landing-page-research`

## Current state

### Part A — Strategy & Structure COMPLETE
- A1 Intake
- A2 Page Structure
- A3 Layout Confirmation
- A4 Conversion Rules
- A5 Copy v0.1
- Initial SEO/AEO direction

### Part B — Visual System COMPLETE
- Arabic-first typography: Tajawal
- Brand green / orange / cream visual system
- Responsive spacing, radii, borders and section rhythm
- Food-first visual direction
- Hero composition
- App screenshot composition
- Motion + reduced-motion behavior
- Mobile-first responsive rules

### Part C — Implementation v0.1 COMPLETE

Implemented under:
`landing-page/site/`

Stack:
- Next.js 16.4
- React 19
- TypeScript
- Tailwind CSS 4 foundation + project CSS tokens
- Playwright responsive QA

Implemented sections:
1. Header
2. Hero with approved food video
3. Proof strip
4. Real Basic Diet food gallery
5. RTL tagline reveal
6. Benefits
7. How it works
8. App showcase using official App Store screenshots
9. Plans
10. Grounded quality proof
11. Accessible FAQ
12. Final CTA
13. Footer

Conversion:
- Primary CTA: `ابدأ اشتراكك`
- iOS routes to verified App Store URL
- Android Store URL remains environment-controlled until a public verified listing is available
- CTA and section-view analytics hooks are implemented

SEO/AEO:
- Arabic metadata implemented
- canonical-ready via `NEXT_PUBLIC_SITE_URL`
- Restaurant structured data
- FAQ structured data

## Verification

Workflow:
`.github/workflows/landing-page-build.yml`

Checks:
- TypeScript typecheck
- Next.js production build
- Chromium responsive QA
- full-page screenshots

Verified viewports:
- 1440×1100
- 390×844
- 320×720

The 320px QA initially detected horizontal overflow in the meal carousel/app phone composition. It was fixed and responsive QA passed.

## Open launch dependencies

1. Verified public Android / Google Play URL
2. Final production domain for `NEXT_PUBLIC_SITE_URL`
3. Optional migration of hero video to Basic Diet-owned CDN/Cloudinary
4. Optional additional locally hosted food images
5. Live verification before publishing numeric rating/review claims
6. Live verification before publishing exact SAR pricing

## Next execution phase

**Preview / deployment + final launch QA**
