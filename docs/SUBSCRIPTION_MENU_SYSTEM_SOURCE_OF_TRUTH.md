# Subscription Menu / Meal Planner Source Of Truth

Internal backend reference: YES
Final Dashboard/Flutter implementation contract: READY FOR CONTRACT REVIEW
Overall readiness: READY FOR DASHBOARD/FLUTTER CONTRACT REVIEW

Decision:

The subscription menu / meal planner backend can be used as the backend source of truth and contract review baseline. Dashboard and Flutter can start implementation against the documented v3 contract.

This is not a claim of full production readiness. Production readiness still depends on environment validation, secrets rotation, deployment checks, and real payment provider staging verification.

## Contract Decisions

- v3 premium large salad validation enforces the backend subscription salad protein allowlist.
- Dashboard relations cannot allow a disallowed premium large salad protein.
- `extra_protein_50g` is rejected for subscription premium large salad.
- Unified day payment create/verify responses include stable safe fields:
  `paymentId`, `payment_id`, `status`, `requiresPayment`, `premiumAmountHalala`, `addonsAmountHalala`, `totalHalala`, `plannerRevisionHash`, `paymentUrl`, and `payment_url`.
- Planner add-on CTA uses `ADDON_PAYMENT_REQUIRED`, not `ONE_TIME_ADDON_PAYMENT_REQUIRED`.
- Dashboard readiness is exposed through `GET /api/dashboard/health/meal-planner`.
- Flutter stale catalog refresh behavior is driven by explicit planner error codes and refresh hints.
- Dashboard-authored Meal Builder draft/published config is the canonical planning source.
- `/api/subscriptions/meal-planner-menu?lang=ar` is the Flutter endpoint and must expose `plannerCatalog.contractVersion=meal_planner_menu.v3`.
- When a published Meal Builder config exists, `/api/subscriptions/meal-planner-menu` compiles it into the canonical `plannerCatalog.sections[].products[].optionGroups[].options[]` shape. `builderCatalog` and `builderCatalogV2` are read-only compatibility fields.
- Published Meal Builder config gates v3 day selections only after a config exists; without one, existing planner fallback behavior remains.
- Meal Builder premium metadata is display-only. Premium balance/payment authority remains in canonical v3 day validation and unified day payment.

## Final Status

READY FOR DASHBOARD/FLUTTER CONTRACT REVIEW

Dashboard/Flutter can begin contract review against:

- `GET /api/subscriptions/meal-planner-menu`
- `GET /api/subscriptions/meal-builder`
- `GET /api/subscriptions/addon-choices`
- `PUT /api/subscriptions/:id/days/:date/selection`
- `POST /api/subscriptions/:id/days/:date/selection/validate`
- `POST /api/subscriptions/:id/days/:date/payments`
- `POST /api/subscriptions/:id/days/:date/payments/:paymentId/verify`
- `POST /api/subscriptions/:id/days/:date/confirm`
- `GET /api/dashboard/health/meal-planner`
- `GET /api/dashboard/meal-builder/readiness`

## Dashboard Meal Builder With Premium Upgrade Support

Canonical builder contract:

- Dashboard draft/publish routes live under `/api/dashboard/meal-builder`.
- Flutter reads `plannerCatalog v3` from `/api/subscriptions/meal-planner-menu`; `/api/subscriptions/meal-builder` remains a published-layout read model.
- No-body `POST /api/dashboard/meal-builder/draft` creates the visual default sections: `premium`, `sandwich`, `chicken`, `beef`, `fish`, `eggs`, and `carbs`.
- Builder sections expose canonical public `type/source` metadata while storing internal `sectionType/sourceKind` compatibility fields.
- Meal Builder selection UI must use `/api/dashboard/meal-builder/pickers/:sectionKey`; global Dashboard menu list endpoints are catalog-management APIs only.
- Stale builder membership errors are `PLANNER_BUILDER_PRODUCT_NOT_INCLUDED`, `PLANNER_BUILDER_GROUP_NOT_INCLUDED`, and `PLANNER_BUILDER_OPTION_NOT_INCLUDED`.

Premium selections are still premium upgrades. Premium proteins, premium meal selections, premium large salad, and premium large salad with allowed protein continue to use existing premium balance and day payment logic.

## Meal Builder Seed / Bootstrap

Bootstrap can create the initial Dashboard-managed builder layout from catalog data when explicitly enabled:

```bash
MEAL_BUILDER_BOOTSTRAP=true npm run bootstrap:data -- --dry-run
NODE_ENV=test MEAL_BUILDER_BOOTSTRAP=true MEAL_BUILDER_BOOTSTRAP_SYNC=true BOOTSTRAP_SYNC=true npm run bootstrap:data -- --sync
```

Source-of-truth rules:

- The seed resolves catalog rows by keys and relations, never hardcoded ObjectIds.
- Bootstrap ownership is explicit: `source=bootstrap`, `createdBySystem=true`, `bootstrapKey=initial_subscription_meal_builder`.
- Admin-created current draft/published configs are not overwritten by default or sync.
- Premium proteins and premium large salad remain premium upgrades; the seed only exposes existing priced premium catalog rows.
- Invalid premium large salad relations, including disallowed proteins or `extra_protein_50g`, block publishing the seeded builder.
