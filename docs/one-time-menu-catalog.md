# One-Time Menu Catalog

This guide covers safe local and staging validation for the pickup-only one-time menu catalog.

## Test Commands

Run the self-contained catalog regression test:

```bash
npm run test:one-time-menu
```

Run the default test suite:

```bash
npm test
```

`npm run test:one-time-menu` uses an in-memory MongoDB instance and does not require Docker or a local MongoDB server.

## Safe Seed Usage

Seed only against local or staging databases:

```bash
NODE_ENV=staging MONGO_URI="<staging mongo uri>" npm run seed:one-time-menu
```

Required environment:

- `MONGO_URI` or `MONGODB_URI`
- `NODE_ENV` set to a non-production value for local/staging validation

The seed is guarded when `NODE_ENV=production`. It exits before connecting unless the operator explicitly sets:

```bash
MENU_SEED_ALLOW_PRODUCTION=true
```

Use the override only for an intentional production menu seed, never for routine validation.

## E2E Validation

Run E2E validation against staging, not Atlas production. Use Moyasar test credentials or an in-process payment mock in a dedicated validation script.

Suggested flow:

1. Run `npm run seed:one-time-menu` against staging.
2. Request `GET /api/orders/menu`.
3. Quote a fixed item.
4. Quote a `per_100g` item.
5. Create an order with a catalog product.
6. Verify `productSnapshot`, `selectedOptions`, `pricingSnapshot`, and `menuVersionId`.
7. Use dashboard menu APIs to hide/show a product and verify inactive items disappear from the customer menu.

## Business Rules To Verify

- Prices are Halala.
- VAT is included; do not add VAT again on clients.
- One-time orders are pickup-only.
- Client-supplied price fields are ignored by backend pricing.
- Delivery fulfillment is rejected for this launch.

## Tech Debt

Current dynamic catalog products can persist their catalog-specific `itemType` values, such as `basic_salad`, on `Order.items`.

Longer term, a cleaner shape would keep `itemType` generic, for example `salad`, and store the specific catalog identity in `productId` or `productKey`, for example `basic_salad`. Do not change this during launch hardening unless a broader contract migration is planned.
