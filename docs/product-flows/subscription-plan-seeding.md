# Subscription Plan Seeding

Subscription plan prices are seeded by:

```bash
npm run seed:subscription-plans
```

The standalone script runs `scripts/seed-subscription-plans.js` and only creates or updates the 3 canonical top-level `Plan` documents. It does not reset or modify users, orders, subscriptions, payments, menu products, categories, or options.

The correct hierarchy is:

- 3 top-level plans: 7 days, 26 days, and 30 days.
- Each plan has 3 gram options: 100g, 150g, and 200g.
- Each gram option has 3 meal options: 1 meal/day, 2 meals/day, and 3 meals/day.

Prices are stored in halala. Frontend clients should display SAR by dividing halala values by `100`.

Seeded top-level plans are identified by stable duration keys:

- `subscription_7_days`
- `subscription_26_days`
- `subscription_30_days`

Do not rely on translated plan names as identifiers.

The script also deactivates the previous incorrect flat seeded keys, such as `subscription_1_meal_7_days_100g`, by setting availability/activity flags to false. It only targets the known wrong seeded keys.
