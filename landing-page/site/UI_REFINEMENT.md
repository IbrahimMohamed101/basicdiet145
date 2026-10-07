# Landing UI refinement — 2026-10-08

Scope: `landing-page/site` only. Starting commit: `537984e1`. This session's eight-stage brief supersedes the earlier one-phase-at-a-time navbar task. No backend, dashboard, API/proxy, business logic, mobile app or infrastructure changes. Local commits on `landing-page-research`; no deployment command.

## Phase 1 — rendered audit and plan (before implementation)

Inspected local production build and the Railway preview in Chromium at 1440 and 390, including every section. Screenshots: repository-local `.audit/refinement/before/` (excluded from Git). Installed existing dependencies with npm, no lockfile/dependency change; initial production build passes.

Strong / preserve:
- Cinematic, uncluttered Hero and approved video/poster.
- Real phone UI and food composition in AppReveal, with direct verified store links.
- Six selected meal assets and allowlisted internal image proxy; never swap for direct Drive URLs.
- Native modal navigation, keyboard behavior and shared motion tokens.

Weak / redesign:
- 5,055-line globals.css includes abandoned Hero/App generations and repeated selectors in the same media context. Later overrides complicate breakpoints.
- Actual mobile document overflow: 522px at a 390px viewport, reproduced on production. Benefits is clipped.
- Flexibility looks like a dashboard mockup with non-working options, repeated copy, tiny labels and multiple borders/gradients.
- Journey repeats three equal columns, decorative badges and customization data; little progression.
- Four Instagram widgets load at once when nearby; native chrome dominates narrow frames. Existing allow="web-share" produces Chromium warnings.
- Plans have large unused space; FAQ repeats information across eight questions; closing CTA repeats a generic action.
- Initial tests include stale AppReveal selectors; existing failures are recorded in `.audit/refinement/before/tests.log` and will be fixed with current-behavior assertions.

Implementation sequence:
1. Consolidate live styles into canonical section stylesheets; remove obsolete declarations. Protect Hero/App/meal geometry across breakpoints.
2. Flexibility: editorial two-column photo + genuine native radio demo (100/150/200g, 1–5 meals, delivery/pickup), compact live summary. Explicit demo; app remains the place to subscribe. No pricing/calorie simulation.
3. Journey: a continuous RTL path, large 01/02/03, a shared visual rather than three cards, vertical progression on mobile; handoff to real Reels.
4. Reels: dark gallery, four official embeds with staged loading, readable attribution, useful fallback links, contained mobile snap scrolling. No scraped media or invented metrics.
5. Plans: compact comparison, shared options once, neutral 26-day emphasis, accurate price-in-app note.
6. Six concise FAQs with meaningful no-JS behavior; final direct-download composition; useful footer with verified links only.
7. Full QA at ten specified viewports, 80/90/100/110/125% zoom equivalents, reduced motion, keyboard, no-JS; real image decoding and rectangle checks.

After each major change: production build, rendered section inspection, regression checks, scoped conventional commit. Final report records all checks, design decisions and remaining platform limitations here.

## Phase 2 — canonical CSS and image geometry

Replaced 5,055-line globals.css with a small import manifest and canonical section stylesheets; removed abandoned section generations. Fixed the missing tablet/mobile FAQ grid breakpoint, the actual source of the 132px page overflow. Preserved Hero/App presentation and motion/navbar tokens. Meal geometry now uses explicit grid tracks/aspect ratios and a contained mobile carousel. Next Image optimizes the existing allowlisted proxy URLs; no API edits. Local image patterns permit query strings only on that proxy.

Validation: production build passes. Rendered 1440px and 768px: all six real images decoded, positive card/image geometry, zero document overflow. Hero/App before/after screenshots inspected. Remaining section refinements and complete test suite follow in subsequent phases.

## Phase 3 — flexibility

Replaced the inert configurator with native radio groups and an aria-live example summary. The editorial salmon image uses the same internal asset as the meal gallery; changing grams does not pretend to resize the food or calculate pricing. Copy distinguishes trying options from completing customization in the app. Reused brand/type/motion tokens. Desktop pairs controls with an arched photograph; mobile gives controls full width before the image. Production build and 1440/390 rendered inspection pass, zero overflow. Artifacts: `.audit/refinement/flexibility/`.

## Phase 4 — connected journey

Replaced three competing card-like columns with a continuous numbered editorial list. Desktop aligns each action with its supporting choice; mobile follows a vertical 01→02→03 reading order. Shared Reveal uses existing motion durations, observer, reduced-motion behavior and visible SSR content. The closing link leads directly to the official Reels gallery. Production build and desktop/mobile rendered inspection pass; zero overflow and preserved Hero/App geometry. Artifacts: `.audit/refinement/journey/`.

## Phase 5 — official Reels gallery

Dark full-width gallery with four official embeds, a 320px minimum frame width, RTL snap scrolling, keyboard focus and direct per-Reel/profile links. No iframe exists at initial load; shared visibility observation mounts only visible cards, staggered by 180ms. No autoplay permission and no downloaded Instagram assets. No-JS visitors retain all four direct links. Production build, desktop/mobile layout and live official embeds inspected (`.audit/refinement/reels/1440-live.png`). Zero page overflow. Instagram owns its internal chrome/content and emits Permissions-Policy warnings for features unsupported by the test Chromium; these are third-party response headers, not first-party hydration/runtime errors. One media preview was temporarily black in live capture; direct links remain available.

## Phase 6 — plans

A single comparison surface replaces detached rounded cards. Duration dominates; the 26-day column uses a quiet green emphasis and the existing neutral “الخيار المتوازن” label. Common options appear once. Mobile uses short rows with aligned actions; exact pricing and plan selection remain explicitly inside the app. No prices or popularity claims added. Production build and 1440/390 rendered inspection pass; zero overflow. Artifacts: `.audit/refinement/plans/`.
