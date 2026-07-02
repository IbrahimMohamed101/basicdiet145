# Backend QA Contract Response

Verified from backend source, dashboard contract docs, and targeted tests on 2026-07-01.

## Credentials / Seed Data

Bootstrap support is split across two safe paths:

- `npm run bootstrap:data` seeds catalog/menu/settings/zones/pickup/subscription-plan data in create-missing-only mode.
- `ALLOW_ACCOUNT_BOOTSTRAP=true npm run bootstrap:data` also creates deterministic non-production dashboard/mobile accounts from `scripts/bootstrap/seed-default-accounts.js`.
- `npm run seed` runs `scripts/seed-demo-data.js`, which creates richer subscription/payment/demo-user scenarios and writes `.codex-temp/subscription-seed-report.json`. The report redacts tokens and dashboard passwords.

Do not post passwords or tokens in GitHub comments. Share any generated target-environment credentials through a secure channel.

| Area | Available? | How To Access / ID Reference | Notes |
|---|---|---|---|
| Dashboard admin/superadmin | Yes | `scripts/bootstrap/seed-default-accounts.js`; enable with `ALLOW_ACCOUNT_BOOTSTRAP=true`; demo seed also creates `admin@basicdiet.sa` and `superadmin@basicdiet.sa` | Non-production only; password source is local seed/env output, not GitHub comments |
| Courier/delivery user | Yes | `courier` dashboard role from account bootstrap or demo seed | `/api/courier/*` accepts `courier` and `admin` roles |
| Kitchen/operator user | Yes | `kitchen` dashboard role from account bootstrap or demo seed | Kitchen routes and ops routes use dashboard auth |
| Cashier/restricted dashboard user | Yes | `cashier` role from `seed-default-accounts.js` (`pickup@basicdiet.com`) | Demo fixture list does not include cashier, but account bootstrap does |
| Customers/users | Yes | `scripts/seed-demo-data.js`, keys in `.codex-temp/subscription-seed-report.json` | Report redacts app tokens |
| Active subscriptions | Yes | `scripts/seed-demo-data.js` | Includes active delivery, active pickup, wallet, premium, add-on, skipped/frozen cases |
| Regular meal balance subscription | Yes | `scripts/seed-demo-data.js` active subscription scenarios | Inspect report plus DB rows tagged `subscription_demo_v2` |
| Premium meal balance subscription | Yes | `premium_overage` scenario in `scripts/seed-demo-data.js` | Includes premium payment/overage data |
| Add-on balance subscription | Yes | `addon_pending` and add-on day payment scenarios in `scripts/seed-demo-data.js` | Covers paid and pending add-on paths |
| One-time orders | Partial | Existing tests cover one-time order flows; bootstrap seed focuses on subscription demo data | No dedicated dashboard QA one-time order seed in bootstrap path was verified |
| Delivery orders | Yes | `scripts/seed-demo-data.js` delivery subscriptions plus generated delivery days; courier tests seed one-time delivery records | Use non-production DB only for mutation QA |
| Active zone | Yes | `scripts/bootstrap/fixtures/subscription-demo-data.js` and `seed-catalog.js` | `GET /api/dashboard/zones?isActive=true` |
| Inactive zone | Yes | Fixture includes active/inactive zones; zone toggle/delete tests verify inactive listing | `GET /api/dashboard/zones?isActive=false` |
| Unused promo code | Test coverage yes; deterministic bootstrap unclear | `tests/dashboardPromoCodes.test.js` creates `FIXED500` and archives it | Add target QA promo manually or through a focused seed if needed |
| Used promo code | Test coverage yes; deterministic bootstrap unclear | `tests/dashboardPromoCodes.test.js` creates consumed `WELCOME10` usage | Used promos cannot be archived by DELETE |
| Menu categories/products/options/groups | Yes | `npm run bootstrap:data` via `seed-catalog.js` | Includes customizable relations and published read contracts |
| Premium upgrade candidates | Yes | `npm run bootstrap:data` runs `backfillPremiumUpgrades()` after catalog/plans | Explicit premium upgrade dashboard tests exist |
| Payment/accounting data | Yes | `scripts/seed-demo-data.js` creates payment rows; `tests/dashboardAccountingDailyReport.test.js` covers accounting daily report | Use report/DB for IDs after seeding |
| Manual deduction data | Test coverage yes; deterministic bootstrap unclear | `tests/dashboardManualDeductionAndOrderPickup.test.js` and `tests/dashboardManualDeductionAddons.test.js` | No standalone manual-deduction QA seed was verified |

Safe destructive QA actions in non-production seeded data: create, update, toggle, archive, and disable are intended safe. Delete is safe only where the endpoint is verified as soft archive/disable (`promo-codes`, `zones`, add-ons). Do not run destructive QA against production.

## Delivery Endpoint Ownership

Verified source: `src/routes/courier.js`, `src/middleware/dashboardAuth.js`, `docs/dashboard-contracts/12_DELIVERY.md`, `tests/dashboardContracts.test.js`, and `tests/operationsDeliveryFlowContract.test.js`.

| Question | Answer |
|---|---|
| Are dashboard users allowed to call `/api/courier/*`? | Yes, but only dashboard users with role `courier`, `admin`, or `superadmin` through role hierarchy. |
| What auth token/role do courier endpoints expect? | Dashboard JWT (`tokenType: dashboard_access`) through `dashboardAuthMiddleware`; route guard allows `courier` and `admin`, with `superadmin` allowed by role middleware. |
| Should `/delivery` use `/api/dashboard/*` instead? | Not required for the current dashboard delivery screen. Existing documented route is `/api/courier/deliveries/today`. |
| Existing recommended endpoint(s) | `GET /api/courier/deliveries/today`, `GET /api/courier/orders/today`, and courier mutations under `/api/courier/...`; dashboard ops also has `/api/dashboard/courier/queue` for operations-board workflows. |
| Backend change needed? | No ownership change applied. |
| Frontend change needed? | Use a dashboard admin/superadmin or courier token for `/delivery`; do not use cashier/kitchen tokens for courier endpoints. |

## Courier allowedActions Contract

Verified source: `src/mappers/deliveryMapper.js`, `src/controllers/courierController.js`, `src/controllers/orderCourierController.js`, and `tests/operationsDeliveryFlowContract.test.js`.

| Question | Answer |
|---|---|
| Does backend return `allowedActions` for courier deliveries/orders? | Yes. Updated now to return structured action objects. |
| Are boolean `can*` flags official contract? | They remain supported compatibility flags, but are not the canonical action-rendering contract. |
| Should frontend generate action labels locally? | No. Use backend `allowedActions[].label`, `method`, and `endpoint`. |
| Recommended DTO shape | `allowedActions: [{ id, label, method, endpoint, disabled, reason }]` plus `allowedActionIds: string[]` and existing `can*` flags. |
| Backend change needed? | Applied now in `src/mappers/deliveryMapper.js`. |
| Frontend change needed? | Render courier buttons from structured `allowedActions`; keep `can*` only as compatibility/secondary state if still needed. |

## Promo Archive Contract

Verified source: `src/controllers/promoCodeController.js`, `src/models/PromoCode.js`, `docs/dashboard-contracts/04_PROMO_CODES.md`, and `tests/dashboardPromoCodes.test.js`.

| Question | Answer |
|---|---|
| Is DELETE soft archive or hard delete? | Soft archive. |
| Field changed by archive | `deletedAt` is set and `isActive` becomes `false`. |
| Response shape | `200 { status:true, data: PromoCodeAdminDTO }` with `deletedAt` and `state.isDeleted:true`. |
| Behavior when promo is in use | `409 PROMO_IN_USE` when `currentUsageCount > 0`; historical references are preserved. |
| How archived promos are listed | Excluded by default; included by `GET /api/dashboard/promo-codes?includeDeleted=true`. |
| Backend change needed? | No. Existing behavior is verified. |
| Frontend change needed? | UI wording should be archive/disable, not permanent delete; use `includeDeleted=true` if archived rows need to be shown. |

## Zone Archive Contract

Verified source: `src/controllers/zoneController.js`, `docs/dashboard-contracts/13_DELIVERY_ZONES.md`, and `tests/dashboardAdminEndpoints.test.js`.

| Question | Answer |
|---|---|
| Is DELETE soft disable or hard delete? | Soft disable. |
| Field changed by disable | `isActive:false`. |
| Response shape | `200 { status:true, data:{ id, isActive:false } }`. |
| Can disabled zone be restored? | Yes, `PATCH /api/dashboard/zones/:id/toggle` flips `isActive`. |
| Does inactive filter show disabled zones? | Yes, `GET /api/dashboard/zones?isActive=false` returns inactive zones. |
| Backend change needed? | No. Existing behavior is verified. |
| Frontend change needed? | Keep delete copy as disable/archive and refetch or apply returned `isActive:false`. |

## Pickup Branches Contract

Verified source: `docs/dashboard-contracts/18_PICKUP_BRANCHES.md`, `src/controllers/adminController.js`, and `tests/dashboardContracts.test.js`.

| Question | Answer |
|---|---|
| Is there a dashboard pickup branches API? | Yes, through dashboard settings. |
| Endpoints | `GET /api/dashboard/settings`; `PATCH /api/dashboard/settings`. |
| Methods | Read all settings; bulk patch `pickup_locations`. |
| Payloads | `{ pickup_locations: [{ id, name:{ar,en}, address:{ar,en}, isActive, latitude?, longitude? }] }`. |
| Response DTO | `{ status:true, data:{ pickup_locations:[...] } }` inside the settings DTO. |
| Frontend route should use this? | Yes, `/pickup-branches` should use dashboard settings unless a dedicated branches collection is introduced later. |
| Backend change needed? | No. Existing settings contract is verified. |

## Auth Me Contract

Verified source: `src/routes/dashboardAuth.js`, `src/controllers/dashboardAuthController.js`, `src/middleware/dashboardAuth.js`, and `tests/dashboardAdminEndpoints.test.js`.

| Question | Answer |
|---|---|
| Is 200 + status:false intentional for auth/me? | Yes. `/api/dashboard/auth/me` uses optional auth for session bootstrap. |
| Should frontend treat it as valid unauthenticated state? | Yes. Treat `{ status:false, user:null, data:{ user:null } }` as logged out. |
| Should this be documented? | Yes; this report documents it. |
| Should protected resources continue returning 401? | Yes. Protected routes use `dashboardAuthMiddleware` and return 401 for missing/invalid token. |
| Backend change needed? | No. Existing behavior is verified. |
| Frontend change needed? | Do not treat unauthenticated `/auth/me` 200 as an API failure. |

## Backend Fixes Applied

- Courier delivery DTOs now return structured `allowedActions` with `id`, `label`, `method`, `endpoint`, `disabled`, and `reason`.
- Courier delivery DTOs now also return `allowedActionIds` for compatibility.
- Dashboard operations transition policy now blocks direct subscription-day `in_preparation -> out_for_delivery`; delivery dispatch must go through `ready_for_delivery`.
- `docs/dashboard-contracts/12_DELIVERY.md` was updated to document the structured action DTO.
- `tests/operationsDeliveryFlowContract.test.js` now asserts the structured courier action contract.

## Frontend Changes Required

- Use dashboard `admin`, `superadmin`, or `courier` auth for `/delivery` courier endpoints.
- Render courier action buttons from `allowedActions`, not locally inferred labels/transitions.
- Treat promo DELETE as archive and zone DELETE as disable.
- Use `includeDeleted=true` for archived promo listing and `isActive=false` for disabled zone listing.
- Use dashboard settings `pickup_locations` for pickup branches.
- Treat unauthenticated `/api/dashboard/auth/me` `200/status:false` as a valid logged-out session bootstrap state.

## Remaining Blockers For Authenticated QA

- Target QA/staging credentials still must be generated and shared through a secure channel; they should not be posted in GitHub comments.
- Deterministic bootstrap covers accounts/catalog/zones/pickup/plans, while richer subscription/payment scenarios come from `npm run seed`.
- Dedicated deterministic bootstrap coverage for one-time order dashboard QA, promo QA rows, and manual-deduction QA rows was not verified as part of `npm run bootstrap:data`; use existing tests or add a focused QA seed if the staging environment needs those exact rows.
