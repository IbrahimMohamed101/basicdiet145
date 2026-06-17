# Screen Contract: 16_SETTINGS

## 1. Screen Purpose
Provides administration for global system configurations, including VAT percentage, skip allowances, premium pricing, and custom salad/meal base prices.

## 2. Dashboard Route
`/settings`

## 3. Visible UI Requirements
* Form displaying current settings values.
* Inputs: VAT percentage, Skip allowance (days), Premium upgrade extra price (SAR), Subscription delivery fee (SAR), Custom salad base price (SAR), Custom meal base price (SAR).
* "Save Settings" button.

## 4. Backend Endpoints
* `GET /api/dashboard/settings` (lists all settings keys and values)
* `PATCH /api/dashboard/settings` (bulk updates settings parameters)
* `PUT /api/dashboard/settings/vat-percentage` (updates VAT percentage key)
* `PUT /api/dashboard/settings/skip-allowance` (updates client skip allowance)
* `PUT /api/dashboard/settings/premium-price` (updates premium meal upgrade price)
* `PUT /api/dashboard/settings/subscription-delivery-fee` (updates delivery fee key)
* `PUT /api/dashboard/settings/custom-salad-base-price` (updates base custom salad price)
* `PUT /api/dashboard/settings/custom-meal-base-price` (updates base custom meal price)

## 5. Request Parameters
* Body (PATCH /settings):
  * A JSON dictionary containing keys to update (e.g. `{ "vat_percentage": 16, "skip_allowance": 3 }`).
* Body (PUT endpoints):
  * Varies depending on key. For instance, `PUT /settings/vat-percentage` accepts `{ "percentage": 16 }` or `{ "vatPercentage": 16 }`.

## 6. Response Fields Required
* `status` (boolean): success status.
* `data` (object): Key-value dictionary of all active system settings:
  * `vat_percentage` (number)
  * `skip_allowance` (number)
  * `premium_price` (number)
  * `subscription_delivery_fee_halala` (number)
  * `custom_salad_base_price` (number)
  * `custom_meal_base_price` (number)

## 7. Field Dictionary
* `vat_percentage`: Value representing system tax percentage. Enforced at 16% in compliance with global tax standards.
* `skip_allowance`: The maximum number of subscription days a user is allowed to skip per billing period.

## 8. Classification
`FINANCIAL_CRITICAL`

## 9. Frontend Restrictions
* **No Local Fallbacks**: Settings values must be fetched from the API. Do not write local defaults for VAT percentages or delivery fees.

## 10. Backend Acceptance Criteria
* Validate settings keys against permitted schemas.
* Persist history and write settings change event to log.

## 11. Contract Tests Required
* Get settings returns required keys.
* Updates settings with valid parameters successfully.

## 12. Known Risks
* Changing the VAT percentage affects payment quotes immediately. Guarded by admin authorization.

## 13. Status
`READY`
