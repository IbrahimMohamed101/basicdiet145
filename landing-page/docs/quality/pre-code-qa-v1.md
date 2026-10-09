# Pre-Code QA Checklist v1.0

**Status:** REQUIRED BEFORE IMPLEMENTATION

## Strategy QA
- [x] One primary conversion
- [x] One primary CTA phrase
- [x] Audience and objections defined
- [x] Page argument fixed
- [x] Section order fixed

## Copy QA
- [x] Hero copy exists
- [x] Section copy exists
- [x] FAQ exists
- [x] Plan copy exists
- [x] No medical/guaranteed weight-loss claims
- [x] No fake “#1/best” claims
- [x] Cancellation intentionally excluded
- [ ] Replace all proof placeholders before production launch

## Visual QA
- [x] Typeface selected
- [x] Palette selected
- [x] Contrast rule defined
- [x] Responsive grid defined
- [x] Motion rules defined
- [x] Reduced-motion behavior defined
- [x] Icon family defined
- [x] Logo variants selected

## Asset QA
- [x] Food shortlist grounded in real Drive assets
- [ ] Hero video visually matches actual food
- [ ] Hero poster extracted
- [ ] App screenshots current and PII-free
- [ ] Testimonials verified
- [ ] Exact rating refreshed if shown
- [ ] Store links verified

## Accessibility QA
- [x] focus states specified
- [x] keyboard behavior specified
- [x] tap target minimum specified
- [x] autoplay audio prohibited
- [x] semantic FAQ requirement
- [x] reduced-motion requirement

## Performance QA
- [x] video has poster/fallback requirement
- [x] image compression required
- [x] lazy load non-hero media
- [x] no heavy motion by default
- [ ] final hero video size checked
- [ ] final LCP checked during build

## Analytics QA
- [x] event names defined
- [x] UTM naming defined
- [x] CTA locations defined
- [x] attribution fields defined
- [x] PII prohibited

## SEO/AEO QA
- [x] evergreen page indexed
- [x] title/meta working copy
- [x] FAQ structure
- [ ] final canonical URL at deployment
- [ ] final structured data validation during build


## Mobile QA
- [x] Mobile is a first-class acceptance target
- [x] 390px primary frame required
- [x] 320px narrow-mobile QA required
- [x] 430px large-phone QA recommended
- [x] Hero mobile crop rules defined
- [x] CTA tap target >=44px
- [x] Single-column section behavior defined
- [x] App screenshot readability rule defined
- [x] Plans stack vertically on phone
- [x] FAQ full-width on phone
- [ ] 390px full-page visual QA during implementation
- [ ] 320px overflow QA during implementation
- [ ] Real-device iOS Safari QA
- [ ] Real-device Android Chrome QA
- [ ] Mobile performance/LCP QA

## Gate

Code may start when:
- hero video OR poster-first state is approved,
- 3+ current app screenshots exist,
- CTA destinations are confirmed.

Everything else has a defined pre-code decision.
