# Landing Page Implementation

Status: **v0.1 implemented and responsive-QA verified**

App:
`landing-page/site/`

## Local commands

```bash
cd landing-page/site
npm install
npm run typecheck
npm run build
npm run dev
```

Responsive QA:

```bash
npx playwright install chromium
npm run qa:visual
```

## Environment

Copy `.env.example` to `.env.local` when deploying.

- `NEXT_PUBLIC_SITE_URL` — final production domain
- `NEXT_PUBLIC_IOS_APP_URL` — defaults to verified Basic Diet App Store URL
- `NEXT_PUBLIC_ANDROID_APP_URL` — set only after public Google Play URL is verified
- `NEXT_PUBLIC_HERO_VIDEO_URL` — optional hero media override
- `NEXT_PUBLIC_HERO_POSTER_URL` — optional poster override

## CI

`.github/workflows/landing-page-build.yml`

CI runs install, typecheck, production build, Chromium responsive QA and screenshot artifact generation.

Viewport gates:
- 1440×1100
- 390×844
- 320×720

The QA fails on horizontal page overflow.

## Launch dependencies

- final production domain
- verified Android Store URL if Android direct routing is required
- final live CTA/store smoke test
- optional migration of hero video to Basic Diet-owned CDN
