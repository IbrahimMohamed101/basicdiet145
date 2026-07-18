# Weight Step Pricing Contract

The backend is the pricing authority for one-time products sold by weight.

## Configuration

For `pricingModel: per_100g`, canonical step pricing is enabled when `weightStepPriceHalala` is present, including zero.

- `priceHalala`: price at the base weight
- `baseUnitGrams`: base weight receiving `priceHalala`
- `defaultWeightGrams`: initially selected weight
- `minWeightGrams`: first selectable weight; must equal `baseUnitGrams`
- `maxWeightGrams`: final selectable weight
- `weightStepGrams`: grams added per step
- `weightStepPriceHalala`: price added per step

The current one-time menu contract also requires the base weight to align with the configured step. For example, 100g/50g is valid and every exposed choice remains accepted by the compatibility validator during migration.

Example: base 100g at 1900 halala, step 50g at 500 halala, maximum 300g produces:

- 100g = 1900 halala
- 150g = 2400 halala
- 200g = 2900 halala
- 250g = 3400 halala
- 300g = 3900 halala

## Dashboard endpoint

`PATCH /api/dashboard/menu/products/:id/weight-pricing`

The endpoint accepts the seven pricing fields above, validates the full configuration, stores it on `MenuProduct`, and returns:

- `contractVersion: dashboard_weight_pricing.v1`
- the updated product
- canonical `weightPricing`

## Public menu

The legacy product payload adds:

- `weightStepPriceHalala`
- `weightPricing`

`publicMenuV2.sections[].products[].pricing` additionally returns:

- `strategy`: `base_plus_steps`, `legacy_per_unit`, or `fixed`
- `requiresWeightSelection`
- `weightStepPriceHalala`
- `weightChoices`: backend-calculated `{ weightGrams, priceHalala }` rows
- `weightPricingContractVersion: weight_pricing.v1`

Clients render the selector and preliminary displayed price from `weightChoices`. They must still call `/api/orders/quote` and replace any preliminary price with the authoritative quote response before checkout.

## Quote request

Send the selected `weightGrams` with the product. The backend validates the range and step and returns the authoritative price.

## Stored order snapshot

Each weighted item stores the selected weight and a `pricingSnapshot.weightPricing` object containing:

- pricing strategy
- selected weight
- base weight and price
- step grams and price
- step count
- calculated weighted price

## Backward compatibility

Existing `per_100g` products without `weightStepPriceHalala` retain the previous per-unit calculation until explicitly migrated through the Dashboard weight-pricing endpoint.
