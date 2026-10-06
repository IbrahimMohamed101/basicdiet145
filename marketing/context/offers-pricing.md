# Offers & Pricing Context

**Version:** v1  
**Last updated:** 2026-10-07

## Subscription structure

Durations:
- 7 days
- 26 days
- 30 days

Portions:
- 100g
- 150g
- 200g

Meals/day:
- 1–5

Fulfillment:
- Delivery
- Pickup

Known fulfillment context:
- Delivery has historically been configured as 200 SAR in current project context.
- Pickup is free.

Known add-on context:
- small_salad: 150 SAR
- snack: 365 SAR

Validate all live prices in the product system before publishing a time-sensitive offer.

## Confirmed package examples

26-day / 150g:
- 1 meal: 659 SAR
- 2 meals: 1186 SAR
- 3 meals: 1732 SAR
- 4 meals: 2309 SAR
- 5 meals: 2886 SAR

These are documented product values from prior implementation work. Live system remains authoritative.

## Promo codes

### KSA96
- Percentage: 30%
- Intended visible promo
- Current business rule: usable for 26- and 30-day plans including 1 meal; 7-day plan excluded.
- Multi-use behavior was requested to avoid user lockout after an incomplete checkout.

### BASIC15
- Percentage: 15%
- Intended visible promo.

## Discount calculation rule

Marketing and product logic should reflect:

`discount = percentage × package subtotal`

Do not apply package promo percentage to:
- delivery,
- daily add-ons.

## Offer strategy

Promo codes are conversion tools, not the core positioning.

Future offer tests can include, when operationally approved:
- free/discounted delivery,
- add-on bundle,
- comeback offer,
- referral benefit,
- partner/gym offer,
- limited bundle.

Every new offer must be evaluated for contribution economics, not just conversion lift.
