# Dashboard Endpoint Matrix

| Method | Path | Group | Permission | Body? | Notes |
|---|---|---|---|---|---|
| POST | `/api/dashboard/auth/login` | Dashboard Auth | admin | Yes | Login to dashboard |
| GET | `/api/dashboard/auth/me` | Dashboard Auth | admin | No | Get current dashboard user |
| POST | `/api/dashboard/auth/logout` | Dashboard Auth | admin | Yes | Logout dashboard session |
| GET | `/api/dashboard/overview` | Overview & Reports | admin | No | Dashboard overview |
| GET | `/api/dashboard/search` | Overview & Reports | admin | No | Global dashboard search |
| GET | `/api/dashboard/notifications/summary` | Overview & Reports | admin | No | Notification summary |
| GET | `/api/dashboard/reports/today` | Overview & Reports | admin | No | Today report |
| GET | `/api/dashboard/subscriptions` | Subscriptions | admin | No | List subscriptions |
| POST | `/api/dashboard/subscriptions` | Subscriptions | admin | Yes | Create subscription from dashboard |
| GET | `/api/dashboard/subscriptions/summary` | Subscriptions | admin | No | Subscription summary |
| GET | `/api/dashboard/subscriptions/export` | Subscriptions | admin | No | Export subscriptions |
| POST | `/api/dashboard/subscriptions/quote` | Subscriptions | admin | Yes | Quote subscription before create |
| GET | `/api/dashboard/subscriptions/{id}` | Subscriptions | admin | No | Get subscription detail |
| GET | `/api/dashboard/subscriptions/{id}/days` | Subscription Days | admin | No | List subscription days |
| POST | `/api/dashboard/subscriptions/{id}/days/{date}/skip` | Subscription Days | admin | Yes | Skip subscription day |
| POST | `/api/dashboard/subscriptions/{id}/days/{date}/unskip` | Subscription Days | admin | Yes | Unskip subscription day |
| PUT | `/api/dashboard/subscriptions/{id}/delivery` | Subscription Management | admin | Yes | Update subscription delivery |
| PATCH | `/api/dashboard/subscriptions/{id}/addon-entitlements` | Subscription Management | admin | Yes | Replace addon entitlements |
| PATCH | `/api/dashboard/subscriptions/{id}/balances` | Subscription Management | admin (superadmin only) | Yes | Replace premium/addon balances |
| GET | `/api/dashboard/subscriptions/{id}/audit-log` | Subscription Management | admin | No | Get subscription audit log |
| POST | `/api/dashboard/subscriptions/{id}/cancel` | Subscription Management | admin | Yes | Cancel subscription |
| PUT | `/api/dashboard/subscriptions/{id}/extend` | Subscription Management | admin | Yes | Extend active subscription |
| POST | `/api/dashboard/subscriptions/{id}/freeze` | Subscription Management | admin | Yes | Freeze subscription |
| POST | `/api/dashboard/subscriptions/{id}/unfreeze` | Subscription Management | admin | Yes | Unfreeze subscription |
| GET | `/api/dashboard/plans` | Plans | admin | No | List plans |
| POST | `/api/dashboard/plans` | Plans | admin | Yes | Create plan |
| GET | `/api/dashboard/plans/{id}` | Plans | admin | No | Get plan |
| PUT | `/api/dashboard/plans/{id}` | Plans | admin | Yes | Update plan |
| DELETE | `/api/dashboard/plans/{id}` | Plans | admin | No | Soft delete/deactivate plan |
| PATCH | `/api/dashboard/plans/{id}/toggle` | Plans | admin | Yes | Toggle plan active state |
| PATCH | `/api/dashboard/plans/{id}/sort` | Plans | admin | Yes | Update plan sort order |
| POST | `/api/dashboard/plans/{id}/clone` | Plans | admin | Yes | Clone plan |
| POST | `/api/dashboard/plans/{id}/grams` | Plans | admin | Yes | Create grams option |
| POST | `/api/dashboard/plans/{id}/grams/clone` | Plans | admin | Yes | Clone grams option |
| DELETE | `/api/dashboard/plans/{id}/grams/{grams}` | Plans | admin | No | Delete grams option |
| PATCH | `/api/dashboard/plans/{id}/grams/{grams}/toggle` | Plans | admin | Yes | Toggle grams option |
| PATCH | `/api/dashboard/plans/{id}/grams/{grams}/sort` | Plans | admin | Yes | Update grams sort order |
| POST | `/api/dashboard/plans/{id}/grams/{grams}/meals` | Plans | admin | Yes | Create meals option |
| POST | `/api/dashboard/plans/{id}/grams/{grams}/meals/clone` | Plans | admin | Yes | Clone meals option |
| DELETE | `/api/dashboard/plans/{id}/grams/{grams}/meals/{mealsPerDay}` | Plans | admin | No | Delete meals option |
| PATCH | `/api/dashboard/plans/{id}/grams/{grams}/meals/{mealsPerDay}/toggle` | Plans | admin | Yes | Toggle meals option |
| PATCH | `/api/dashboard/plans/{id}/grams/{grams}/meals/{mealsPerDay}/sort` | Plans | admin | Yes | Update meals sort order |
| GET | `/api/dashboard/addons` | Addons | admin | No | List addons |
| POST | `/api/dashboard/addons` | Addons | admin | Yes | Create addon |
| GET | `/api/dashboard/addons/{id}` | Addons | admin | No | Get addon |
| PUT | `/api/dashboard/addons/{id}` | Addons | admin | Yes | Update addon |
| DELETE | `/api/dashboard/addons/{id}` | Addons | admin | No | Soft delete addon |
| PATCH | `/api/dashboard/addons/{id}/toggle` | Addons | admin | Yes | Toggle addon |
| GET | `/api/dashboard/addon-plans` | Addon Plans | admin | No | List addon-plans |
| POST | `/api/dashboard/addon-plans` | Addon Plans | admin | Yes | Create addon-plan |
| GET | `/api/dashboard/addon-plans/{id}` | Addon Plans | admin | No | Get addon-plan |
| PUT | `/api/dashboard/addon-plans/{id}` | Addon Plans | admin | Yes | Update addon-plan |
| PATCH | `/api/dashboard/addon-plans/{id}/toggle` | Addon Plans | admin | Yes | Toggle addon-plan |
| PATCH | `/api/dashboard/addons/{id}/sort` | Addons | admin | Yes | Update addon sort order |
| POST | `/api/dashboard/addons/{id}/clone` | Addons | admin | Yes | Clone addon |
| GET | `/api/dashboard/zones` | Delivery Zones | admin | No | List delivery zones |
| POST | `/api/dashboard/zones` | Delivery Zones | admin | Yes | Create delivery zone |
| GET | `/api/dashboard/zones/{id}` | Delivery Zones | admin | No | Get delivery zone |
| PUT | `/api/dashboard/zones/{id}` | Delivery Zones | admin | Yes | Update delivery zone |
| DELETE | `/api/dashboard/zones/{id}` | Delivery Zones | admin | No | Soft delete delivery zone |
| PATCH | `/api/dashboard/zones/{id}/toggle` | Delivery Zones | admin | Yes | Toggle delivery zone |
| GET | `/api/dashboard/health/catalog` | Health & Diagnostics | admin | No | Catalog health |
| GET | `/api/dashboard/health/subscription-menu` | Health & Diagnostics | admin | No | Subscription menu health |
| GET | `/api/dashboard/health/meal-planner` | Health & Diagnostics | admin | No | Meal planner health |
| GET | `/api/dashboard/health/indexes` | Health & Diagnostics | admin | No | Index health |
| GET | `/api/dashboard/payments` | Payments | admin | No | List payments |
| GET | `/api/dashboard/payments/{id}` | Payments | admin | No | Get payment |
| POST | `/api/dashboard/payments/{id}/verify` | Payments | admin | Yes | Verify Moyasar payment |
| GET | `/api/dashboard/users` | Users | admin | No | List app users |
| POST | `/api/dashboard/users` | Users | admin | Yes | Create app user |
| GET | `/api/dashboard/users/{id}` | Users | admin | No | Get app user |
| PUT | `/api/dashboard/users/{id}` | Users | admin | Yes | Update app user |
| GET | `/api/dashboard/users/{id}/subscriptions` | Users | admin | No | List user subscriptions |
| GET | `/api/dashboard/dashboard-users` | Dashboard Users | admin | No | List dashboard users |
| POST | `/api/dashboard/dashboard-users` | Dashboard Users | admin | Yes | Create dashboard user |
| GET | `/api/dashboard/dashboard-users/{id}` | Dashboard Users | admin | No | Get dashboard user |
| PUT | `/api/dashboard/dashboard-users/{id}` | Dashboard Users | admin | Yes | Update dashboard user |
| DELETE | `/api/dashboard/dashboard-users/{id}` | Dashboard Users | admin | No | Delete dashboard user |
| POST | `/api/dashboard/dashboard-users/{id}/reset-password` | Dashboard Users | admin | Yes | Reset dashboard user password |
| PATCH | `/api/dashboard/settings` | Settings | admin | Yes | Patch settings |
| GET | `/api/dashboard/settings/restaurant-hours` | Settings | admin | No | Get restaurant hours |
| PUT | `/api/dashboard/settings/restaurant-hours` | Settings | admin | Yes | Update restaurant hours |
| PUT | `/api/dashboard/settings/cutoff` | Settings | admin | Yes | Update cutoff |
| PUT | `/api/dashboard/settings/delivery-windows` | Settings | admin | Yes | Update delivery windows |
| PUT | `/api/dashboard/settings/skip-allowance` | Settings | admin | Yes | Update skip allowance |
| PUT | `/api/dashboard/settings/premium-price` | Settings | admin | Yes | Update premium price |
| PUT | `/api/dashboard/settings/subscription-delivery-fee` | Settings | admin | Yes | Update subscription delivery fee |
| PUT | `/api/dashboard/settings/vat-percentage` | Settings | admin | Yes | Update VAT percentage |
| PUT | `/api/dashboard/settings/custom-salad-base-price` | Settings | admin | Yes | Update custom salad base price |
| PUT | `/api/dashboard/settings/custom-meal-base-price` | Settings | admin | Yes | Update custom meal base price |
| GET | `/api/dashboard/content/terms/subscription` | Content | admin | No | Get subscription terms content |
| PUT | `/api/dashboard/content/terms/subscription` | Content | admin | Yes | Upsert subscription terms content |
| GET | `/api/admin/meal-planner-menu/proteins` | Meal Planner Catalog | admin | No | List proteins |
| POST | `/api/admin/meal-planner-menu/proteins` | Meal Planner Catalog | admin | Yes | Create proteins |
| PUT | `/api/admin/meal-planner-menu/proteins/{id}` | Meal Planner Catalog | admin | Yes | Update proteins |
| DELETE | `/api/admin/meal-planner-menu/proteins/{id}` | Meal Planner Catalog | admin | No | Soft delete proteins |
| GET | `/api/admin/meal-planner-menu/premium-proteins` | Meal Planner Catalog | admin | No | List premium proteins |
| POST | `/api/admin/meal-planner-menu/premium-proteins` | Meal Planner Catalog | admin | Yes | Create premium proteins |
| PUT | `/api/admin/meal-planner-menu/premium-proteins/{id}` | Meal Planner Catalog | admin | Yes | Update premium proteins |
| DELETE | `/api/admin/meal-planner-menu/premium-proteins/{id}` | Meal Planner Catalog | admin | No | Soft delete premium proteins |
| GET | `/api/admin/meal-planner-menu/carbs` | Meal Planner Catalog | admin | No | List carbs |
| POST | `/api/admin/meal-planner-menu/carbs` | Meal Planner Catalog | admin | Yes | Create carbs |
| PUT | `/api/admin/meal-planner-menu/carbs/{id}` | Meal Planner Catalog | admin | Yes | Update carbs |
| DELETE | `/api/admin/meal-planner-menu/carbs/{id}` | Meal Planner Catalog | admin | No | Soft delete carbs |
| GET | `/api/admin/meal-planner-menu/sandwiches` | Meal Planner Catalog | admin | No | List sandwiches |
| POST | `/api/admin/meal-planner-menu/sandwiches` | Meal Planner Catalog | admin | Yes | Create sandwiches |
| PUT | `/api/admin/meal-planner-menu/sandwiches/{id}` | Meal Planner Catalog | admin | Yes | Update sandwiches |
| DELETE | `/api/admin/meal-planner-menu/sandwiches/{id}` | Meal Planner Catalog | admin | No | Soft delete sandwiches |
| GET | `/api/admin/meal-planner-menu/addons` | Meal Planner Catalog | admin | No | List addons |
| POST | `/api/admin/meal-planner-menu/addons` | Meal Planner Catalog | admin | Yes | Create addons |
| PUT | `/api/admin/meal-planner-menu/addons/{id}` | Meal Planner Catalog | admin | Yes | Update addons |
| DELETE | `/api/admin/meal-planner-menu/addons/{id}` | Meal Planner Catalog | admin | No | Soft delete addons |
| GET | `/api/admin/meal-planner-menu/salad-ingredients` | Meal Planner Catalog | admin | No | List salad ingredients |
| POST | `/api/admin/meal-planner-menu/salad-ingredients` | Meal Planner Catalog | admin | Yes | Create salad ingredients |
| PUT | `/api/admin/meal-planner-menu/salad-ingredients/{id}` | Meal Planner Catalog | admin | Yes | Update salad ingredients |
| DELETE | `/api/admin/meal-planner-menu/salad-ingredients/{id}` | Meal Planner Catalog | admin | No | Soft delete salad ingredients |
| GET | `/api/dashboard/ops/list` | Operations Board | admin/kitchen/courier | No | List operations board |
| GET | `/api/dashboard/ops/search` | Operations Board | admin/kitchen/courier | No | Search operations |
| POST | `/api/dashboard/ops/actions/{action}` | Operations Board | admin/kitchen/courier | Yes | Execute operations action |
