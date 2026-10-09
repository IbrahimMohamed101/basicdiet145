# Basic Diet Landing Page — Premium Motion & Visual Enhancement Brief

## Role

You are a **Senior Frontend Engineer + Creative Web Developer + UI Motion Designer**, with the judgment of an **Art Director**.

**Project:** Basic Diet Landing Page  
**Primary language:** Arabic (RTL)  
**Branch:** `landing-page-research` — it already exists. **Do not create a new branch.**

---

## Mission

Elevate the current landing page into a premium experience that combines:

- a refined food-tech brand,
- a modern Saudi lifestyle identity,
- and the polish of a high-end product landing page.

The user should feel that **Basic Diet is a modern, capable, easy-to-use app**, not just a diet restaurant.

Motion should guide attention, not distract from it. **Performance, responsive behavior, accessibility, and visual quality have equal priority.**

---

## Execution Mode — One Phase at a Time

We will improve the page **phase by phase**.

This rule overrides any temptation to continue automatically:

1. Perform Setup and Discovery once when needed.
2. Execute **only the single phase explicitly requested in the current Codex task**.
3. Run the full Quality Gate for that phase.
4. Commit and push that phase to `landing-page-research`.
5. Send the phase report.
6. **Stop and wait for explicit approval before starting the next phase.**

Never batch multiple phases into one implementation task unless the user explicitly asks for that.

---

## Non-Negotiable Rules

1. **Preserve & Enhance**  
   Do not rebuild the project or redesign the identity. Keep the existing stack, architecture, and styling approach. If an existing solution is better than your proposed change, keep it and improve it.

2. **Brand Identity**  
   Use the actual Basic Diet green, dark ink text, warm off-white backgrounds, and a small accent derived from the red/orange in the logo. Extract the real values from the code/logo. Do not introduce random new colors.

3. **Progressive Enhancement**  
   All content must remain visible and meaningful without animation and without JavaScript. Never hide content in CSS unless JavaScript is guaranteed to reveal it, using a safe pattern such as a `js-ready` class. Avoid flashes and hydration mismatch.

4. **No Invented Data**  
   Do not fabricate reviews, numbers, ratings, links, company details, or marketing claims. Every user-facing fact, number, and link must come from the project. Any new microcopy, such as a badge label, must be listed in the report.

5. **Scope Guard**  
   Do not modify backend logic, APIs, checkout, payments, analytics, tracking, routing, or SEO metadata. Do not delete dependencies. Do not replace the approved hero video. Do not rewrite existing content unless necessary for the requested visual improvement.

6. **Safe Git Only**  
   No reset, force push, rebase, or destructive Git operation.

7. **Never Leave a Broken Build**  
   Do not commit or push a failing state.

---

## Autonomy & Escalation

Make small design and implementation decisions independently and record assumptions in the report.

Stop and ask only if:

- the working tree is dirty at the beginning,
- `git pull --ff-only` fails,
- push is rejected,
- a new dependency is required,
- WebGL/Three.js appears necessary,
- missing data/assets block an entire section.

If a new dependency seems necessary, explain:

- why it is needed,
- its approximate gzipped size,
- the no-dependency alternative,

and continue with a CSS/native temporary solution until approved.

**Reports and explanations:** Arabic.  
**Code, filenames, and commit messages:** English.

---

# Setup

Run this first:

```bash
git status
git remote -v
git branch -a
git fetch origin
git checkout landing-page-research
git pull --ff-only origin landing-page-research
```

Rules:

- If `git status` is not clean, stop and report it. Do not stash or reset.
- Detect the package manager from the lockfile and use only that package manager.
- Install dependencies if needed, without changing the lockfile unnecessarily.
- Read the scripts in `package.json` for dev, lint, typecheck, build, and tests.
- Start the project locally.

---

# Discovery — Before Writing Code

1. Read:
   - `package.json`,
   - framework config,
   - app/layout/entry files,
   - landing-page components,
   - styles/tokens/Tailwind config,
   - assets: video, poster, images, app screenshots,
   - package/meals/FAQ data files,
   - font setup,
   - icon system.

2. Identify:
   - framework,
   - rendering mode: SSR / SSG / SPA,
   - existing animation libraries,
   - reusable hooks/utilities,
   - current `<html lang dir>` setup.

3. Open the page in a real browser using available Playwright/Puppeteer tooling, or `npx playwright` without adding it as a project dependency.

4. Capture section screenshots at:
   - 360px
   - 390px
   - 430px
   - 768px
   - 1024px
   - 1440px

   Save them under:

   ```
   .audit/baseline/
   ```

   Add `.audit/` to `.git/info/exclude` locally. Do not modify `.gitignore` for audit artifacts.

5. Record a baseline:
   - Lighthouse mobile on a production build, 3 runs, median result,
   - bundle size,
   - hero video size, codec, duration, resolution,
   - poster size.

6. Write short findings before the first code change:
   - architecture,
   - risks,
   - missing assets/data,
   - implementation plan for the requested phase.

---

# Required Loop for Every Phase

For every phase:

1. Inspect the current section in the browser.
2. Make small, section-scoped changes.
3. Re-check the result at all six widths.
4. Also test:
   - reduced-motion emulation,
   - no-animation state,
   - no-JavaScript state where practical.
5. Run automated checks:
   - no horizontal scroll:
     `document.documentElement.scrollWidth <= innerWidth`,
   - no console errors,
   - no meaningful console warnings,
   - no hydration warnings,
   - no obvious layout shift during entrance.
6. Run the Quality Gate.
7. Make one logical conventional commit.
8. Push the phase after all checks pass.
9. Produce the phase report.
10. Stop and wait for approval.

Do not make broad changes across the entire page in one phase.

---

# Motion System — Single Source of Truth

Use design/motion tokens through the existing theme system, CSS variables, or current styling approach.

### Durations

- Micro: 200ms, acceptable range 150–250ms
- UI transition: 320ms, acceptable range 250–400ms
- Section reveal: 650ms, acceptable range 500–800ms
- Hero cinematic motion: maximum 1000ms, only on initial entrance

### Easings

Use a small consistent set, for example:

```css
cubic-bezier(0.22, 1, 0.36, 1)
```

plus one consistent in-out easing.

Do not use random easing values.

### Reveal Rhythm

- reveal distance: approximately 24px
- stagger step: approximately 60–90ms
- total stagger sequence: maximum approximately 600ms

### Preferred Animated Properties

Prefer:

- opacity
- transform
- translate
- scale
- rotate
- rotateX
- rotateY
- perspective

Use `clip-path` only when necessary.

Avoid animating:

- width
- height
- top
- left
- margin

unless there is a documented reason. FAQ expansion using `grid-template-rows` is an expected exception.

Use `will-change` only temporarily and only on active animated elements.

---

## Shared Motion Utilities

Reuse existing utilities if available. Otherwise create small native utilities without adding dependencies.

Recommended shared primitives:

- a `Reveal` abstraction or `data-reveal` system using **one shared IntersectionObserver**,
- unobserve after first reveal,
- `useReducedMotion`,
- `usePointerFine` using `(hover: hover) and (pointer: fine)`,
- both hooks must be SSR-safe,
- rAF-based lerp/spring only while interaction is active and element is visible,
- stop rAF when stable and when `document.hidden`,
- `useScrollProgress` throttled with rAF and gated by IntersectionObserver,
- write scroll progress directly to a CSS variable such as `--p` instead of React state every frame,
- passive listeners,
- separate DOM reads from writes.

### Animation Library Priority

1. Use an animation library already installed, such as Motion/Framer Motion.
2. Otherwise prefer CSS + IntersectionObserver.
3. Use GSAP only if the interaction cannot be implemented cleanly without it, and document the reason first.
4. **Three.js/WebGL is not allowed by default. Use CSS 3D first.**

---

## Reduced Motion

For `prefers-reduced-motion: reduce`:

- disable parallax,
- disable tilt,
- disable continuous animation,
- disable marquee,
- disable video autoplay and show poster only,
- show content immediately or with opacity only at <=150ms.

---

## Motion Hierarchy

- Hero: High
- App phones: High — signature section
- Meals: Medium
- How it works: Medium
- Benefits: Low–Medium
- Pricing: Low–Medium
- Final CTA: Low — mostly depth
- Navbar / CTA / FAQ: Micro interactions
- Footer: Almost static

Not everything should move.

---

# RTL & Arabic Rules

- Use CSS logical properties such as:
  - `margin-inline`
  - `padding-inline`
  - `inset-inline-start`
  - `text-align: start`
- Horizontal reveal, progress lines, marquee, parallax, and tilt must visually respect RTL.
- Never split Arabic text into individual letters for animation because it breaks letter joining.
- Stagger by line or word only.
- Never apply letter-spacing to Arabic text.
- Ensure line-height prevents clipping of Arabic glyphs/diacritics inside masked or overflow-hidden containers.
- Flip directional icons such as arrows/chevrons for RTL; do not flip non-directional icons.
- Keep numbers, prices, currency, and phone numbers consistent. Use `dir="ltr"` or `<bdi>` where appropriate.
- To prevent overflow from out-of-frame decorative elements, use `overflow: clip` on the relevant wrapper. Do not globally hide horizontal overflow on `body`.
- Prefer `svh`/`dvh` over `vh`.

---

# Performance Rules

Mobile goals under throttling:

- LCP <= 2.5s
- CLS <= 0.05
- INP <= 200ms where measurable
- use TBT as a laboratory proxy and manually test interactions with CPU 4x throttling

Rules:

- Stop continuous animations outside the viewport and when the tab is hidden.
- Motion must not delay the LCP element.
- Compare before/after.
- Minimize expensive blur/backdrop-filter and large blurred shadows, especially on mobile.
- Prefer precomputed radial gradients over large filtered blur elements.
- Use `font-display: swap`.
- Preload only essential fonts.
- Use a good fallback stack to reduce CLS.
- Do not add dependencies without justification.
- Report bundle-size delta.

---

# Hero Video Rules

The approved hero video must remain unchanged unless the user explicitly approves replacement/re-encoding.

Requirements:

- poster matching the frame aspect ratio, preferably WebP/AVIF,
- poster is an LCP candidate: eager + `fetchpriority="high"`,
- video attributes:
  - `muted`
  - `playsinline`
  - `loop`
  - `preload="metadata"` or `none` if justified,
- only one large hero video,
- play/pause using IntersectionObserver,
- pause when out of view,
- gracefully handle rejected `play()` such as Low Power Mode,
- fall back to poster,
- reduced-motion or Save-Data: poster only,
- provide a small non-intrusive pause/play control for WCAG 2.2.2.

If the video is too heavy, do not alter it silently. Document the issue in:

```
docs/landing-motion-notes.md
```

Include recommended encoding guidance such as:

- H.264 MP4 with faststart,
- 720p mobile variant,
- optional WebM,
- remove audio,
- 24–30fps,

with example ffmpeg commands.

---

# Images

For images below the fold:

- `loading="lazy"`
- `decoding="async"`

Above-the-fold images may be eager, but only the LCP asset should use `fetchpriority="high"`.

Always provide:

- explicit width/height or fixed aspect ratio,
- responsive sizing,
- framework-native image component where appropriate,
- AVIF/WebP where supported.

Food images:

- consistent aspect ratio,
- intentional `object-position`,
- no bad cropping,
- useful Arabic alt text.

---

# Accessibility

Do not sacrifice accessibility for animation.

Requirements:

- WCAG AA contrast:
  - 4.5:1 for normal text,
  - 3:1 for large text and UI,
- verify the glass navbar over varying backgrounds,
- consistent visible `:focus-visible`,
- skip link,
- full keyboard navigation,
- semantic links vs buttons,
- landmarks,
- correct heading order,
- `aria-current` for active navigation,
- `aria-expanded` and `aria-controls` where needed,
- decorative content uses `aria-hidden`,
- touch targets >=44x44px,
- no important behavior depends only on hover.

---

# Design Tokens

Organize existing design values in the current system rather than creating a parallel design system.

Cover:

- colors and semantic aliases,
- spacing scale,
- radius,
- shadows: elevation 1–3 + glow,
- typography with a fluid scale,
- container widths,
- z-index scale,
- motion durations,
- motion easings.

Replace magic values only in the sections being modified. Do not perform a broad unrelated refactor.

---

# Phases

## Phase 1 — Motion Foundation + Tokens

Build the shared motion utilities and tokens.

Also create/update:

```
docs/landing-motion-notes.md
```

### Acceptance

- build passes,
- no visual regression,
- reduced-motion works globally,
- tokens are actually used,
- no dependency added without approval.

---

## Phase 2 — Navbar

Implement a premium floating navigation.

Requirements:

- measured glass effect,
- solid fallback when `backdrop-filter` is unsupported,
- subtle border,
- subtle shadow,
- lighter/larger at top of page,
- clearer/more compact after scrolling,
- use an IntersectionObserver sentinel instead of a continuous scroll listener,
- size change is allowed only if fixed/overlay and does not cause CLS,
- active section tracking with IntersectionObserver and tuned `rootMargin`,
- active indicator animated with transform,
- `aria-current`,
- `scroll-margin-top` on anchor targets,
- smooth scrolling respects reduced motion.

### Mobile Navigation

Build a true mobile navigation, not a compressed desktop navbar.

Requirements:

- menu control >=44px,
- accessible sheet/drawer,
- one-hand friendly,
- focus trap,
- Escape closes,
- outside click/tap closes,
- selecting a link closes,
- scroll lock without layout shift,
- CTA inside the menu,
- transform/opacity animation only,
- no invented links.

---

## Phase 3 — Hero

This is one of the most important sections.

Create a premium video presentation.

Requirements:

- large video card,
- refined radius,
- subtle shadow,
- subtle ambient light using radial gradients,
- 2–3 low-cost depth layers inspired by the brand,
- small floating badge whose text comes from existing project content,
- subtle floating decorative elements:
  - translateY approximately +/-6–8px,
  - 6–9 second cycle,
  - transform only,
  - stop outside viewport,
  - disabled in reduced-motion.

### Desktop — Fine Pointer Only

Use CSS perspective.

Pointer-follow tilt limits:

- rotateX <= +/-2deg
- rotateY <= +/-3deg

Use smooth lerp/spring interpolation and return to zero after pointer exit.

Do not attach mouse-follow listeners on touch/mobile.

Verify 3D video rendering for flicker, especially Safari.

### Mobile / Touch

- no tilt,
- no pointer listeners,
- simple opacity + translate entrance.

### Headline

- stagger by line or word, never by Arabic letter,
- initial load only,
- complete within <=1000ms,
- source text remains present in HTML,
- primary CTA must remain visible in the first viewport at 360x640 where practical.

### CTA

- hover lift 1–2px,
- subtle shadow,
- active `scale(.98)`,
- optional light sweep via pseudo-element transform on hover only,
- no repeating shimmer,
- hover styles only inside `@media (hover: hover)`,
- touch feedback through `:active`.

The hero should feel premium, not flashy.

---

## Phase 4 — Meals Showcase

Food should be the visual focus.

Requirements:

- staggered reveal on entrance,
- desktop hover:
  - image scale <=1.04,
  - card translateY <=-4px,
  - nutritional info reveals or moves subtly,
- optional tilt <=3deg on fine pointer only,
- no tilt on touch,
- nutritional info must remain visible on touch and must come only from project data,
- Desktop: 3 cards,
- Tablet: 2 columns or a suitable scroll-snap layout,
- Mobile: clear cards; if horizontal carousel is used, it must use container scroll-snap without causing page-level horizontal overflow,
- no bad image crop.

---

## Phase 5 — Benefits / Why Basic Diet

Each benefit should contain:

- simple 24–28px icon using the existing icon system or inline SVG,
- sequential label such as 01–0N — this is ordering, not a fabricated metric,
- short title,
- short description from current content.

Motion:

- staggered reveal,
- subtle hover elevation,
- small accent interaction,
- no touch-only information hidden behind hover.

---

## Phase 6 — How It Works

Steps:

1. Choose your plan
2. Customize your meals
3. Track your subscription

Use the existing Arabic copy/descriptions from the project.

### Desktop

- connect steps with a CSS line,
- in RTL the line should progress from the right,
- animate using scaleX,
- progress may be tied subtly to viewport/scroll,
- step points activate progressively,
- no heavy SVG animation.

### Mobile

- vertical flow,
- scaleY from the top,
- each step reveals when entering the viewport.

---

## Phase 7 — App / Phones Signature Section

This is a signature visual section.

Create a 3-phone composition using CSS 3D.

### Desktop

- stage perspective approximately 1200–1600px,
- center phone is the hero phone:
  - largest,
  - highest z-index,
- side phones sit behind it:
  - opposite rotateY/rotateZ directions,
  - subtle translation,
  - no overflow.

Use the existing app screenshots.

If only one valid screenshot exists:

- do not invent UI,
- use it for the center phone,
- use neutral frames/crops for side devices,
- list the missing assets in the report.

### Scroll-Linked Motion

Phones begin slightly closer together and smaller, then open into the final composition as scroll progress `--p` advances.

The final state should be reached before the section ends.

CSS scroll-driven animation via `animation-timeline` may be used only as progressive enhancement behind `@supports`.

Without JS or with reduced motion, show the final composition immediately.

### Desktop Fine Pointer

Add only a very small parallax to the entire phone group:

- translate <=8–10px,
- rotation <=1.5deg,
- rAF only while visible.

Do not animate every phone independently with pointer movement.

Add:

- soft radial light,
- lightweight floating shadow via gradient.

No WebGL.

### Mobile

- center phone stays dominant,
- side phones remain behind with less rotation/scale,
- composition must stay inside the container at 360px,
- `overflow: clip`,
- no mouse parallax,
- no expensive scroll-linked animation,
- simple reveal is enough.

If WebGL appears necessary, stop and explain the visual value before implementing it.

---

## Phase 8 — Packages / Conversion

Keep all real package data unchanged.

Requirements:

- package names, prices, durations, features, and subscription links remain sourced from the project,
- 26-day plan is the featured plan when that plan exists in the actual data,
- badge: `الأكثر اختيارًا`,
- clearer border/shadow,
- desktop scale <=1.03,
- mobile: no scaling that creates overflow,
- staggered reveal,
- hover: subtle translateY + border/shadow,
- no bouncing,
- buttons must have high contrast,
- full-width CTA on mobile,
- correct RTL price/currency formatting.

If the plan data does not actually contain a 26-day option, stop and report the mismatch.

---

## Phase 9 — Trust + FAQ

### Trust

First search the project for real:

- reviews,
- metrics,
- logos,
- certifications,
- trust assets.

Do not invent anything.

If real data exists:

- use horizontal cards or an appropriate marquee,
- marquee pauses on hover/focus,
- reduced-motion uses static/scrollable layout,
- duplicate marquee items must be `aria-hidden`.

If real data does not exist:

- build only a typed component/data contract with an empty guard,
- render nothing in production,
- record it under **Needs data**.

### FAQ

Use real buttons.

Requirements:

- `aria-expanded`,
- `aria-controls`,
- content region with appropriate semantics,
- Enter/Space behavior,
- optional Up/Down arrow keyboard navigation,
- closed content should not remain focusable,
- animate without layout glitches using `grid-template-rows: 0fr -> 1fr` + opacity, or supported `interpolate-size`,
- avoid measuring height with JS unless necessary,
- plus icon transforms into minus through transform,
- preserve the current single-open vs multi-open behavior.

---

## Phase 10 — Final CTA + Footer

### Final CTA

- Basic Diet green brand section,
- large balanced headline using `text-wrap: balance`,
- subtle depth through CSS radial gradients / brand-inspired abstract shapes,
- no stock illustration,
- high-contrast CTA,
- little or no motion.

### Footer

Organize available content into:

- Basic Diet,
- page links,
- Instagram,
- WhatsApp,
- policies,
- available company details.

Do not invent missing links or company information.

External links use:

```
rel="noopener noreferrer"
```

Icon-only links require `aria-label`.

---

## Phase 11 — Mobile Polish

Mobile is a first-class experience, not a scaled-down desktop version.

Test:

- 360
- 390
- 430
- 768
- 1024
- 1440+
- short-height landscape
- 200% text zoom

Forbidden:

- horizontal page scrolling,
- clipped text,
- overlapping elements,
- hover-dependent functionality,
- touch targets <44px,
- body text smaller than approximately 16px.

### Mobile Sticky CTA

Keep it and improve it.

Behavior:

- appears after the Hero CTA leaves the viewport,
- hides when Packages enters view,
- hides when Final CTA enters view,
- hides while the mobile menu is open,
- height <= approximately 64px,
- respects `safe-area-inset-bottom`,
- add enough page padding so content is never covered,
- do not overlap other floating UI such as WhatsApp,
- one clear action,
- animate using transform/opacity only.

---

## Phase 12 — Performance + Accessibility Audit

Run Lighthouse on production build:

- mobile: 3 runs, median,
- desktop: 3 runs, median.

Targets:

- Performance >=90
- Accessibility >=95
- Best Practices >=95
- SEO >=90

Review:

- LCP,
- CLS,
- INP where available,
- TBT as lab proxy,
- Performance trace with CPU 4x and Slow 4G,
- long tasks,
- layout shifts during entrance,
- unused JS,
- bundle delta vs baseline.

Accessibility audit:

- axe/Lighthouse,
- full keyboard walkthrough,
- reduced-motion,
- Save-Data behavior.

State clearly if a screen reader was not tested.

Fix clear performance problems, but do not destroy the visual design just to chase a score.

Update:

```
docs/landing-motion-notes.md
```

with:

- motion-system usage,
- tokens,
- how motion is disabled,
- before/after metrics,
- video recommendation,
- Needs data,
- known issues.

---

# Quality Gate — Required After Every Phase

Run all that exist in the project:

- lint,
- typecheck,
- build,
- tests.

Also verify:

- clean console,
- no hydration warnings,
- automated overflow check at all target widths,
- reduced-motion behavior,
- content remains meaningful without animation,
- no-JS behavior where practical.

Every failure must be fixed before commit/push.

---

# Git Workflow

After the requested phase:

1. Review:
   ```bash
   git diff --stat
   ```

2. Commit with a logical conventional commit, for example:
   - `feat(landing): add premium hero motion system`
   - `feat(landing): enhance meals interactions`
   - `feat(landing): add 3d app showcase`
   - `feat(landing): improve pricing and mobile experience`
   - `perf(landing): optimize motion and responsive assets`

3. Do not commit:
   - screenshots,
   - Lighthouse artifacts,
   - `node_modules`,
   - `.env`,
   - local audit files.

4. Push only to:
   ```
   landing-page-research
   ```

5. If push is rejected, stop and report it. Never force push.

---

# Phase Report Format

After every phase, report in Arabic using this exact structure:

## Phase N — Name

- **What changed:** files + reason
- **Before/After:** screenshot paths
- **QA:** table for 360 / 390 / 430 / 768 / 1024 / 1440 + reduced-motion + no-JS
- **Quality Gate:** lint / typecheck / build / tests
- **Performance:** bundle delta + LCP/CLS observations
- **Assumptions / open issues / Needs data or assets**
- **Commit hash**
- **Push status**

Then stop and wait for approval.

---

# Definition of Done

The landing-page enhancement is complete only when:

- every phase has been implemented and approved one at a time,
- every Quality Gate is green,
- the branch is pushed,
- no horizontal scroll exists at target widths,
- no console errors remain,
- the page remains meaningful without animation and without JavaScript,
- final before/after metrics are documented,
- targets are achieved or any miss is clearly explained,
- no fabricated reviews, metrics, links, or company data were introduced.

---

# Start Protocol

When this brief is referenced from a Codex task:

1. Sync `landing-page-research`.
2. Read this entire file before editing.
3. Read `docs/landing-motion-notes.md` if it exists.
4. Determine the **single phase requested by the current task**.
5. If this is the first phase/session, run Setup + Discovery + baseline.
6. Execute only that phase using the required loop.
7. Run the full Quality Gate.
8. Commit and push.
9. Report in Arabic.
10. **Stop. Do not start the next phase until explicitly asked.**
