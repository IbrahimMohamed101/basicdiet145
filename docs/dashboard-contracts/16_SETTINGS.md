# Screen Contract: Settings

<<<<<<< HEAD
## 1. Screen Purpose

The Settings screen is a lightweight Arabic-only ownership and navigation screen for general settings. It must not become a duplicate editor for pricing, menu configuration, delivery zones, premium upgrades, or restaurant operations.

No truly general editable setting is currently proven to be both effective and correctly owned by this screen. Until such a setting is introduced with a tested backend contract, the screen displays Arabic guidance rather than editable inputs.

## 2. Dashboard Route

`/settings`

## 3. Visible UI Requirements

* All visible interface text is Arabic.
* Explain that no general settings are currently editable from this screen.
* Link only to verified owner routes:
  * Delivery fees: `/zones`
  * Custom meal and salad configuration: `/menu`
  * Premium upgrade pricing: `/premium-meals`
  * Restaurant hours, delivery windows, and cutoff: `/restaurant-hours`
* Explain that VAT is controlled by backend financial configuration and is not editable from the Dashboard.
* Do not render a settings form or save button when there are no owned editable settings.

## 4. Endpoints Used by This Screen

None.

The active Settings screen does not call `GET /api/dashboard/settings` or `PATCH /api/dashboard/settings` because it has no owned editable settings. This prevents foreign-owner or persisted-only keys from being presented as authoritative controls.

## 5. Backward-Compatible Backend Endpoints

The backend continues to expose the following admin endpoints for compatibility and dedicated consumers:

* `GET /api/dashboard/settings`
* `PATCH /api/dashboard/settings`
* `PUT /api/dashboard/settings/cutoff`
* `PUT /api/dashboard/settings/delivery-windows`
* `PUT /api/dashboard/settings/skip-allowance`
* `PUT /api/dashboard/settings/premium-price`
* `PUT /api/dashboard/settings/subscription-delivery-fee`
* `PUT /api/dashboard/settings/vat-percentage`
* `PUT /api/dashboard/settings/custom-salad-base-price`
* `PUT /api/dashboard/settings/custom-meal-base-price`

Their continued existence does not make every stored key an effective or Settings-owned Dashboard control.

## 6. Ownership Rules

| Setting / Area | Current Key or Source | Owner | Settings UI Rule |
| --- | --- | --- | --- |
| Zone delivery fee | `Zone.deliveryFeeHalala` | Delivery Zones | Hidden; manage in `/zones` |
| Subscription delivery fallback | `subscription_delivery_fee_halala` | Backend delivery fallback | Hidden; not presented as the main delivery fee |
| Custom meal price | `custom_meal_base_price` | Menu / Meal Builder | Hidden |
| Custom salad price | `custom_salad_base_price` | Menu / Meal Builder | Hidden |
| Premium upgrade price | `PremiumUpgradeConfig` | Premium Upgrades | Manage in `/premium-meals`; legacy `premium_price` is hidden |
| Restaurant open/close | `restaurant_open_time`, `restaurant_close_time`, `restaurant_is_open` | Restaurant Hours | Hidden; manage in `/restaurant-hours` |
| Delivery windows | `delivery_windows` | Restaurant Hours | Hidden; manage in `/restaurant-hours` |
| Cutoff time | `cutoff_time` | Restaurant Hours | Hidden; manage in `/restaurant-hours` |
| Subscription skip allowance | Plan `skipPolicy` | Packages / subscription plan policy | Legacy `skip_allowance` is hidden |
| VAT | Backend `VAT_PERCENTAGE` configuration | Backend finance configuration | Read-only explanation; no editable input |

## 7. Business Authority

* Backend behavior remains the source of truth.
* The Dashboard must not infer that a persisted key is operationally effective.
* VAT remains controlled by `src/config/vat.js`; the `vat_percentage` database key is not an authoritative pricing control.
* Premium upgrades remain controlled by `PremiumUpgradeConfig`; `premium_price` must not be reconnected as an active control.
* Zone delivery fees remain controlled by Zone records and backend quote services.
* Custom meal and salad pricing behavior is unchanged and remains with menu configuration.

## 8. Roles

The `/settings` Dashboard route is available to `admin` and `superadmin`. The compatibility backend settings endpoints are also restricted to those roles.

## 9. Frontend Restrictions

* Do not call Settings mutation endpoints while the screen has no owned editable keys.
* Do not submit hidden, legacy, fallback-only, or foreign-owner keys.
* Do not add local financial defaults or calculations.
* Do not add a navigation link unless its Dashboard route exists and is permitted for the same roles.

## 10. Contract Tests Required

* The screen displays Arabic ownership guidance.
* The screen renders no generic editable settings form.
* Foreign-owner keys are absent from the screen and cannot be submitted.
* Navigation targets are limited to `/zones`, `/menu`, `/premium-meals`, and `/restaurant-hours`.
* Existing settings endpoint URL helpers remain backward compatible.

## 11. Known Limitations

* Legacy and fallback keys remain stored and writable through backward-compatible backend endpoints.
* The backend response does not yet include ownership/effectiveness metadata.
* No general business setting currently qualifies for editing on this screen.

## 12. Status

`READY_WITH_LIMITATIONS`
=======
## 1. Status

Status: `DASHBOARD_CONTRACT_ALIGNED_LIGHTWEIGHT`

## 2. Screen ownership

This general Settings screen owns no editable setting. It is a navigation/guidance surface only.

| Setting area | Correct owner |
|---|---|
| Delivery zone fees | Delivery Zones |
| Premium upgrade prices | Premium Upgrades |
| Custom meal/salad prices | Menu / Meal Builder |
| Restaurant hours | Restaurant Hours |
| Delivery windows | Restaurant Hours |
| Cutoff time | Restaurant Hours |
| VAT | Backend finance config unless proven editable |
| Skip policy | Plans / subscription policy |

## 3. Frontend implementation status

The current Dashboard screen is aligned with this lightweight contract. There is no create/edit form and no current Settings-owned API call.

## 4. Backend authority rules

- Do not submit hidden or foreign setting keys from this screen.
- Do not present VAT as editable unless the backend pricing path is separately proven to consume that setting.
- Existing settings routes are backward-compatible operational endpoints, not permission to build a generic key/value editor.
- Unknown settings must be labeled `VERIFY_IN_BACKEND_BEFORE_USE`, not inferred.

## 5. Active endpoints

None owned by the current general Settings UI.

The following existing route families are `legacy`, `advanced`, `not current UI-owned`, and **must not be exposed as primary Settings controls**:

| Route/family | Classification | Correct UI owner |
|---|---|---|
| `/api/dashboard/settings/restaurant-hours` | advanced, canonical for its feature | Restaurant Hours |
| `/api/dashboard/settings/cutoff` | legacy/advanced | Restaurant Hours |
| `/api/dashboard/settings/delivery-windows` | legacy/advanced | Restaurant Hours |
| `/api/dashboard/settings/skip-allowance` | legacy/advanced | Plans/subscription policy |
| `/api/dashboard/settings/premium-price` | legacy/advanced | Premium Upgrades |
| `/api/dashboard/settings/subscription-delivery-fee` | legacy fallback | Delivery Zones/pricing operations |
| `/api/dashboard/settings/vat-percentage` | legacy/advanced | Backend finance config |
| `/api/dashboard/settings/custom-salad-base-price` | legacy/advanced | Menu / Meal Builder |
| `/api/dashboard/settings/custom-meal-base-price` | legacy/advanced | Menu / Meal Builder |

## 6. Endpoint details

There are no endpoint calls to document for this screen. Frontend implementation must not call a catch-all settings endpoint on mount or submit.

### Legacy/advanced endpoint handling

#### Purpose
Reference classification only; these endpoints belong to feature-specific screens.

#### Auth
Roles:
- admin

#### Query params

Not applicable to this screen.

#### Request body

Do not send one from this screen.

#### Request example

```json
{}
```

#### Success response example

```json
{}
```

#### Response fields

Not consumed by this screen.

#### Error responses

```json
{"status":false,"message":"This setting is not owned by the general Settings screen"}
```

#### Frontend notes
This is intentionally not an API contract. Follow the linked owner screen's contract before using any route.

## 7. Forms and UI controls

No editable controls, create form, save button, or hidden payload fields exist.

| UI element | Arabic label | Frontend control | Behavior |
|---|---|---|---|
| Delivery Zones card | مناطق التوصيل | readonly | Navigate to Delivery Zones |
| Premium Upgrades card | ترقيات الوجبات | readonly | Navigate to Premium Upgrades |
| Menu card | قائمة الطعام وبناء الوجبات | readonly | Navigate to Menu / Meal Builder |
| Restaurant Hours card | ساعات عمل المطعم | readonly | Navigate to Restaurant Hours |
| Plans card | خطط وسياسات الاشتراك | readonly | Navigate to Plans |
| VAT guidance | ضريبة القيمة المضافة | readonly/backend-owned | Explain that finance configuration is backend-owned |

## 8. Tables and detail views

No table or detail API view. Render guidance cards. Empty-state copy: `لا توجد إعدادات عامة قابلة للتعديل هنا. اختر القسم المختص لإدارة الإعداد.`

Suggested introduction: `تم توزيع الإعدادات على الشاشات المختصة لتجنب التعارض في الأسعار والسياسات.`

## 9. Response DTO reference

None. The screen has no response DTO. Navigation card configuration should be frontend-static and contain only label, description, icon, and route.

## 10. Error responses

There is no expected network error state because the screen makes no API request. A route/navigation failure may use: `تعذر فتح القسم المطلوب.`

## 11. Business rules

- A setting's backend existence does not make it general-Settings-owned.
- Never post all settings together.
- Never duplicate delivery, pricing, hours, or policy controls here.
- VAT display is informational and backend-owned unless a verified finance contract supersedes this document.

## 12. Frontend checklist

- [ ] Render guidance/navigation cards only.
- [ ] No data-fetch on screen load.
- [ ] No Save button or editable form.
- [ ] No VAT input.
- [ ] No hidden setting keys submitted.
- [ ] Each card routes to its owning screen.

## 13. Examples

Card copy: `ساعات عمل المطعم — إدارة أوقات الفتح والإغلاق ونوافذ التوصيل ووقت الإقفال.`

## 14. Unsupported / future features

- Generic key/value settings editor.
- Editable VAT on this screen.
- Bulk save across setting domains.
- Secret/environment configuration.
- Any endpoint or field not listed in an owner-specific contract (`VERIFY_IN_BACKEND_BEFORE_USE`).
>>>>>>> c9532d8f (04_PROMO_CODES.md)
