# Project Status

**Last updated:** 2026-10-07

## Current Phase

**V1 IMPLEMENTED + AUTOMATED RESPONSIVE QA PASSED ✅**

The strategy/design gate is closed and the first production-oriented landing-page implementation now exists under:

`landing-page/site/`

## Completed

- A1 Intake
- A2 Page Structure
- A3 Layout Confirmation
- A4 Conversion Rules
- A5 Copy v0.1
- SEO/AEO direction
- Part B Visual System
- Component/Layout Specification
- Figma Handoff Specification
- Visual Asset Shortlist
- Hero Video Brief + approved Hero Video v1
- Analytics/Attribution Specification
- Next.js implementation scaffold
- Header + Hero
- Proof strip
- Food experience using vendored real Basic Diet images
- Tagline reveal
- Benefits
- How it works
- App showcase using official App Store screenshots
- Plans
- Grounded quality proof
- FAQ
- Final CTA
- Footer
- Structured data
- Landing analytics hooks
- GitHub Actions build/typecheck
- Playwright responsive visual QA

## Locked visual identity

- Typeface: Tajawal
- Primary green: #108055
- Accent orange: #E95E2C
- Main cream: #FFFAE8
- Muted cream: #F6F4E2
- Ink: #161A16

## Primary conversion

**First paid subscription through the Basic Diet app**

## Primary CTA

**ابدأ اشتراكك**

## Hero

- approved Hero Video v1
- desktop: video left / Arabic copy right
- mobile: video first / copy below
- no baked-in text
- safe fallback behavior

## Layout

Header → Hero → Proof Strip → Food → Tagline → Benefits → How It Works → App → Plans → Quality Proof → FAQ → Final CTA → Footer

## Build stack

- Next.js 16 App Router
- React 19
- TypeScript
- Tailwind CSS 4
- Arabic/RTL-first
- indexable evergreen page

## Automated verification

Latest successful workflow:

**Landing Page Build — PASS**

Run:
https://github.com/IbrahimMohamed101/basicdiet145/actions/runs/37561914192

Checks passed:
- npm install
- TypeScript typecheck
- Next production build
- Chromium production-server smoke
- 1440px full-page visual QA
- 390px mobile visual QA
- 320px narrow-mobile overflow QA

The 320px QA previously found a real 4px carousel overflow; it was fixed and the final run passed.

## Remaining before public launch

1. Verify/publish the final Android destination if Android CTA should go to Google Play.
2. Set final public `NEXT_PUBLIC_SITE_URL`.
3. Deploy the Next.js landing service/domain.
4. Real-device QA:
   - iOS Safari
   - Android Chrome
5. Launch-time proof refresh if exact rating/review count is shown.
6. Add approved testimonial quotes only if verified.

## CTA behavior in current V1

- iOS → verified Apple App Store listing.
- Android → uses `NEXT_PUBLIC_ANDROID_APP_URL` only when a verified URL is configured.
- If Android URL is not configured, CTA safely returns the visitor to the app section instead of inventing a destination.

## Current implementation status

**CODE V1 COMPLETE. NOT YET PUBLICLY DEPLOYED.**
