# Codex Task — Phase 2: Premium Navbar

## Context

Repository: `IbrahimMohamed101/basicdiet145`  
Branch: `landing-page-research`

The master implementation brief is:

`docs/LANDING_BRIEF.md`

Phase 1 has already been completed and pushed. Its implementation notes are:

`docs/landing-motion-notes.md`

Completed Phase 1 commit:

`2ceb04ad38feaaca4e11969d97f1bee8e3e1cc93`

Do not redo Phase 1.

---

## Task

Execute **ONLY Phase 2 — Navbar** from `docs/LANDING_BRIEF.md`.

Do not begin Phase 3 or modify the Hero beyond any tiny integration strictly required for Navbar behavior.

The goal is to turn the current navigation into a premium floating navigation that feels deliberate on desktop and mobile, while remaining fast, accessible, RTL-correct, and free of layout shift.

---

## Start

Sync safely:

```bash
git status
git remote -v
git branch -a
git fetch origin
git checkout landing-page-research
git pull --ff-only origin landing-page-research
```

If the working tree is dirty, pull fails, or there is a conflict: stop and report it. Do not stash, reset, rebase, or force.

Then read, in full:

1. `docs/LANDING_BRIEF.md`
2. `docs/landing-motion-notes.md`
3. the current Navbar/Header implementation
4. the Phase 1 motion utilities and tokens that are already available

Use the Phase 1 infrastructure rather than creating a parallel motion system.

---

## Scope — Navbar Only

Implement the following.

### 1. Premium Floating Desktop Navbar

Preserve the Basic Diet identity.

The navbar should have:

- a controlled glass effect,
- subtle border,
- subtle elevation/shadow,
- strong readable contrast over every section,
- a solid/fallback appearance if `backdrop-filter` is unsupported.

At the top of the page it should feel slightly more open/light.

After the user scrolls, it should become slightly more compact and visually clearer.

Use an **IntersectionObserver sentinel**, not a continuous scroll listener, for the top/scrolled state.

Any compacting must not introduce CLS.

Prefer transform/opacity or dimensions on fixed/overlay content only.

Do not add large blur surfaces that hurt mobile performance.

### 2. Active Section State

Implement active navigation state based on the visible section using IntersectionObserver.

Requirements:

- tune `rootMargin` so the active state feels natural,
- use `aria-current="page"` or the correct semantic value on the active navigation item,
- animate the visual active indicator with transform/opacity only,
- do not animate layout properties unnecessarily,
- section anchors should use `scroll-margin-top` so headings are not hidden behind the floating navbar,
- smooth scrolling must respect `prefers-reduced-motion`.

RTL behavior must be visually correct.

### 3. Real Mobile Navigation

Do not compress the desktop nav into a tiny row.

Build a proper mobile menu/sheet/drawer using the existing project architecture.

Requirements:

- menu button touch target >=44x44px,
- clear accessible label,
- correct `aria-expanded` and `aria-controls`,
- panel should be easy to use with one hand,
- CTA remains available inside the mobile menu,
- opening/closing uses transform + opacity,
- Escape closes the menu,
- clicking/tapping outside closes it,
- choosing a navigation link closes it,
- focus is trapped inside while open,
- focus returns to the menu button when closed,
- background scroll is locked without causing layout shift,
- no invented links,
- no duplicate actionable elements exposed to screen readers,
- menu must not create page-level horizontal overflow.

When the menu is open, any existing sticky/mobile CTA must not overlap or compete with it.

### 4. Visual Quality

The result should feel premium but restrained.

Use the existing Phase 1 tokens for:

- colors,
- radius,
- borders,
- shadows,
- easing,
- durations,
- z-index.

Avoid:

- exaggerated blur,
- glowing neon effects,
- bouncing,
- large transforms,
- decorative animation with no purpose.

The logo must remain crisp and visually readable.

Do not change brand assets unless fixing a technical rendering issue.

---

## Responsive QA

Inspect the Navbar in the real browser at:

- 360
- 390
- 430
- 768
- 1024
- 1440

Also test:

- short landscape viewport,
- 200% text zoom,
- keyboard-only navigation,
- reduced motion,
- no-animation mode,
- no JavaScript state where practical,
- all relevant page sections while scrolling.

Verify:

```js
document.documentElement.scrollWidth <= innerWidth
```

at every required width.

There must be:

- no horizontal overflow,
- no clipped menu content,
- no text collisions,
- no content hidden behind the navbar after anchor navigation,
- no console errors,
- no hydration warnings,
- no layout jump when the navbar changes state.

---

## Performance

Do not add dependencies.

Use the existing Phase 1 motion utilities and browser APIs.

Avoid continuous scroll handlers.

Avoid React state updates every animation frame.

Do not worsen LCP for the Hero.

Compare bundle size against the Phase 1 baseline and report the delta.

---

## Accessibility

Verify:

- keyboard opening/closing,
- focus trap,
- focus restoration,
- Escape,
- outside click,
- visible focus styles,
- screen-reader semantics,
- touch target sizes,
- contrast on light and green sections,
- active item semantics,
- reduced-motion behavior.

Do not hide essential navigation in the no-JS state if the current architecture allows a usable fallback. If a full no-JS mobile drawer is not practical in the current architecture, preserve readable primary navigation/CTA and document the limitation rather than introducing a brittle hack.

---

## Quality Gate

Run every available check:

- typecheck,
- build,
- tests,
- visual/Playwright QA,
- `git diff --check`,
- console/hydration inspection,
- overflow checks.

If no lint script exists, state that explicitly; do not add one just for this phase.

Fix all failures before committing.

---

## Git

Review:

```bash
git diff --stat
```

Commit Phase 2 only, for example:

```
feat(landing): upgrade responsive navigation
```

Push only to:

`landing-page-research`

Never force push.

---

## Report

Report in Arabic using the format required by `docs/LANDING_BRIEF.md`.

Also include:

- exact desktop behavior at top vs scrolled state,
- active-section logic,
- mobile-menu accessibility behavior,
- bundle-size delta compared with Phase 1,
- screenshots for closed/open mobile menu and desktop top/scrolled states,
- any limitations that remain.

---

## Stop Condition

After Phase 2 is implemented, tested, committed, and pushed:

**STOP.**

Do not start Hero work.
Do not start Phase 3.
Wait for explicit approval.
