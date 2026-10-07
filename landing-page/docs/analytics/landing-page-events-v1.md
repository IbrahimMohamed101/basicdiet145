# Analytics & Attribution Specification v1.0

**Status:** PRE-BUILD SPEC COMPLETE

## North-star conversion
**First paid subscription**

Landing-page clicks are leading indicators only.

## Events

### lp_view
Params:
- source
- medium
- campaign
- content
- landing_variant
- device_category

### lp_cta_click
Params:
- location: header | hero | app | plans | final
- label
- destination
- plan_duration when relevant

### lp_store_outbound
Params:
- platform: ios | android | unknown
- location
- campaign

### lp_plan_interest
Params:
- duration: 7 | 26 | 30
- action: view | cta_click

### lp_faq_open
Params:
- question_id

### lp_section_view
Fire once per session for:
- food
- benefits
- app
- plans
- proof
- faq

### lp_hero_video_status
Params:
- status: loaded | poster_only | failed
- reduced_motion: true | false

Do not fire high-frequency video progress events.

## Attribution

Persist:
- utm_source
- utm_medium
- utm_campaign
- utm_content
- utm_term
- landing_variant

Pass attribution into app/deep-link flow where technically possible.

## Store routing

At implementation:
- iOS → verified App Store
- Android → verified Google Play destination when available
- desktop/unknown → platform chooser or app landing destination

Never send users to an unverified Android URL.

## UTM convention

`utm_source`: instagram | tiktok | whatsapp | google | direct

`utm_medium`: organic_social | paid_social | referral | cpc

`utm_campaign`: lowercase stable campaign name

`utm_content`: creative identifier

`landing_variant`: evergreen | campaign_variant

## Questions the data should answer

- Which source drives first paid subscribers?
- Which CTA location produces useful app transitions?
- Which plan gets the most interest?
- Where do visitors stop?
- Does video failure affect CTA rate?
- Which campaign/landing variant converts downstream?

## Privacy

Never put PII in analytics URLs or UTMs:
- phone
- email
- customer name
- subscription ID
