# Part B — Visual System v1.0

**Date:** 2026-10-07  
**Status:** COMPLETE FOR DESIGN HANDOFF  
**Direction:** Premium food editorial, Arabic-first, mobile-first

## Visual direction

Basic Diet should feel appetizing, clean, premium but approachable, and modern without looking like a generic SaaS or bodybuilding brand.

Avoid:
- neon/dark gym aesthetics
- clinical layouts
- huge icon grids
- excessive glass effects
- background gradients
- ecommerce density

## Typography

**Typeface: Tajawal**

Reason:
- Arabic-first
- already used in the Basic Diet Flutter project
- consistent with the app
- readable on mobile

Weights:
- 400 Regular
- 500 Medium
- 700 Bold

No italics.

### Type scale

Use Tailwind default type scale.

| Role | Mobile | Desktop |
|---|---|---|
| Hero | text-3xl | text-5xl |
| Tagline reveal | text-4xl | text-6xl |
| Section heading | text-3xl | text-4xl |
| Card heading | text-xl | text-2xl |
| Lead | text-base | text-lg |
| Body | text-base | text-base |
| Small/meta | text-sm | text-sm |
| Buttons | text-base | text-base |

Headings: text-wrap balance.  
Body: text-wrap pretty.

Hero heading may use text-only gradient from `#161A16` to `#666666`. No background gradients.

## Brand colors

Colors sampled/adapted from current Basic Diet logo and social creative.

| Token | Hex | Use |
|---|---|---|
| brand-green | #108055 | Primary brand / CTA |
| brand-green-hover | #0D6E49 | Hover/active |
| brand-orange | #E95E2C | Accent |
| cream | #FFFAE8 | Main background |
| cream-muted | #F6F4E2 | Alternate background |
| surface | #FFFFFF | Cards |
| ink | #161A16 | Primary text |
| text-muted | #667069 | Supporting text |
| border | #DDD9C8 | Soft borders |
| error | #B42318 | Error state |

Accessibility:
- green works as normal text on cream.
- white works on green buttons.
- orange is not used for normal body text on cream; use it as accent/icon/large highlight.

## Background rhythm

- Hero: cream
- Value strip: cream
- Food: white/cream
- Tagline: cream-muted
- Benefits: cream
- How it works: white
- App: brand-green
- Plans: cream
- Proof: white
- FAQ: cream-muted
- Final CTA: brand-green
- Footer: ink/deep green

No background gradients.

## Spacing

Allowed tokens only:
`0, 2, 4, 8, 12, 16, 24, 32, 40, 48, 64, 80, 96px`

Section spacing:
- desktop 80–96px
- tablet 64–80px
- mobile 48–64px

Container:
- max width 1200px
- desktop horizontal padding 24–32px
- mobile 16px

## Radius

- buttons: rounded-xl / 12px
- chips: rounded-full
- cards: rounded-2xl / 16px
- hero media and large panels: rounded-3xl / 24px

Nested radius formula applies when gap <32px.

## Borders and shadows

- full border or none
- no single-side card borders
- 1px soft border where needed
- subtle shadows only

## Icons

Use **Phosphor Icons**.  
Do not use Material Icons.

## Hero composition

### Desktop
RTL 12-column grid:
- copy on right: 5 columns
- video on left: 7 columns

Video is a separate media panel, not background video.

Video:
- 4:3 or 5:4
- rounded-3xl
- autoplay muted loop
- poster fallback

Text max width: 680px.

### Mobile
Order:
1. video
2. headline
3. supporting copy
4. CTA
5. proof line

Video:
- 4:5 or 1:1
- centered subject
- no text overlay

## Food image treatment

Use real Basic Diet food photography.

Rules:
- preserve natural color
- no aggressive filters
- no artificial green tint
- consistent crop treatment
- keep plate/food intact
- avoid marketplace-like density

## App section

Background: brand-green.  
Text: white/cream.

Use 3–5 real screens:
- one primary phone large
- supporting screens partially layered

No fake UI.

## Buttons

### Primary
- bg brand-green
- white text
- rounded-xl
- text-base semibold
- min height 44px

Hover:
- brand-green-hover
- subtle translate/scale

Active:
- scale 0.98

Focus:
- visible 2px ring with offset

### Secondary
Text link in ink/green + arrow icon.

Do not add a large orange competing CTA.

## Navigation

Compact floating pill.

Desktop:
- detached from top
- cream/white translucent surface
- subtle blur
- rounded-full

Mobile:
- logo + CTA + hamburger
- hamburger morphs into X
- expanded menu uses cream/green overlay

## Motion

Base easing:
`cubic-bezier(0.32,0.72,0,1)`

Major transitions: ~700ms.

Scroll reveal:
`translate-y-16 blur-md opacity-0 → translate-y-0 blur-0 opacity-100`
over ~800ms.

Use IntersectionObserver/framework equivalent.

### Tagline reveal
- word-by-word
- starts ~30% opacity
- full color as words cross trigger zone
- RTL reading order respected

### Reduced motion
- disable word-by-word effects
- use poster or reduce autoplay motion where practical
- simple opacity transitions

## States

Every interactive element needs:
- hover
- active
- focus
- disabled
- loading where relevant
- error where relevant

## Accessibility

- WCAG AA contrast
- visible focus states
- keyboard navigation
- semantic landmarks
- skip-to-content
- meaningful alt text
- decorative images ignored appropriately
- reduced-motion support
- no autoplay audio
- tap targets >=44px


## Mobile-first quality bar

Mobile is a first-class design target, not a scaled-down desktop layout.

### Required target widths
- 390px primary mobile design
- 320px narrow-mobile QA
- 430px large-phone QA
- 768px tablet transition

### Mobile composition rules
- Every section must be intentionally recomposed for a single-column reading flow.
- No desktop card row may simply shrink until text becomes cramped.
- Avoid horizontal overflow at every target width.
- Keep readable line lengths and preserve Arabic RTL hierarchy.
- Primary CTA must remain visually dominant and easy to reach.
- Minimum interactive target: 44px.
- Avoid tiny labels, cramped cards, and multi-column content below 640px unless proven usable.

### Mobile Hero
- Hero media must never dominate the whole first screen.
- Target media height should leave headline + CTA reachable with minimal scroll.
- Use the approved poster when autoplay is restricted or reduced-motion is enabled.
- Preserve the main food subject when cropping the 16:9 master.
- If center-crop damages the food composition, use a dedicated mobile crop rather than forcing desktop framing.
- No text over the video on mobile.

### Mobile navigation
- Compact logo + primary CTA + hamburger.
- Menu must open as a clear full-screen/large-sheet navigation surface.
- No tiny desktop nav links squeezed into mobile.

### Mobile food section
- Prefer one strong card at a time or a deliberate horizontal swipe pattern.
- Do not display 3–4 narrow meal cards side by side.
- Images must stay large enough to sell appetite.

### Mobile app showcase
- One primary screenshot/phone at a time.
- Supporting screens can swipe/stack.
- Avoid overlapping devices that make screen content unreadable.

### Mobile plans
- Stack 7 / 26 / 30 day cards vertically.
- CTA stays full-width or near full-width.
- Do not compress three pricing cards into one row.

### Mobile FAQ
- Full-width accordion rows.
- Comfortable vertical spacing.
- Question text may wrap to multiple lines without clipping.

### Mobile performance
- Prefer poster-first loading for slow networks.
- Lazy-load below-the-fold images/screenshots.
- Serve appropriately sized responsive images.
- Video must not block LCP or first interaction.

### Acceptance rule
A design is not approved because desktop looks good.

V1 requires visual approval at:
- 1440px desktop
- 390px mobile
- 320px narrow mobile

No implementation section is considered complete until those three widths are checked.

## Result

Part B visual system is locked for V1.
