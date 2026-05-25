# Backend Dashboard Contract Report

## Overall Backend Dashboard Contract Readiness
- Score: 67/100
- Recommendation: Ready with fixes before full dashboard release

## Critical Backend Issues

No critical backend-only issue was confirmed that independently blocks all dashboard use. Dashboard release remains blocked by frontend build/readiness and missing UI flows.

## High Backend Issues

### Issue 1
- Severity: High
- Category: Response/error contract
- Backend file path: `src/controllers/dashboard/menuController.js`
- Line number if possible: 117-123, 137-164
- Related dashboard file/API: `src/lib/apiErrors.ts`, `src/hooks/useMutationWithToast.ts`
- What is wrong: Some dashboard menu errors bypass the standard `{ ok:false, error:{ code, message, details } }` shape, returning `{ status:false, code, message }` or `{ message }`.
- Why it matters: Dashboard error parsing and release contract require stable standard errors for 400/401/403/404/409/422/500.
- Admin/customer impact: Admins may see generic or missing messages for invalid field and rollback failures.
- Suggested fix in plain English: Route all dashboard menu errors through `errorResponse` with stable codes and details.
- Type: Backend-only issue

### Issue 2
- Severity: High
- Category: Rollback contract/safety
- Backend file path: `src/controllers/dashboard/menuController.js`, `src/services/orders/menuCatalogService.js`
- Line number if possible: controller 133-164; service 934-1052
- Related dashboard file/API: no dashboard rollback UI currently
- What is wrong: Rollback controller auto-publishes a backup, calls restore, then publishes again, but returns a custom `{ success, restoredVersion, backupVersion }` shape. The service restore only restores fields present in the public one-time snapshot, not all draft/catalog metadata.
- Why it matters: Architecture requires rollback safety. Current response shape differs from other dashboard routes, and rollback may not restore `availableFor`, `isVisible`, product names/descriptions, option metadata, or subscription-only fields.
- Admin/customer impact: A rollback may produce a menu that looks restored for one-time order snapshots but leaves subscription catalog metadata inconsistent.
- Suggested fix in plain English: Define a rollback response contract, store complete catalog snapshots, and restore all dashboard-controlled fields atomically.
- Type: Backend-only issue

### Issue 3
- Severity: High
- Category: Product-specific option pricing isolation
- Backend file path: `src/services/orders/menuCatalogService.js`
- Line number if possible: 891-905
- Related dashboard file/API: `src/components/pages/menu/relations/MenuProductRelationsTab.tsx:725-735`
- What is wrong: `updateProductGroupOption` validates `groupId` but fetches/updates by `{ productId, optionId }`, not `{ productId, groupId, optionId }`.
- Why it matters: If an option relation is ever duplicated across product groups or data is inconsistent, a product-specific price update can target the wrong relation.
- Admin/customer impact: Product-specific option price isolation can be violated.
- Suggested fix in plain English: Include `groupId` in the find and update query, and return 404 if that exact relation is absent.
- Type: Dashboard/backend contract mismatch

### Issue 4
- Severity: High
- Category: Backend test readiness
- Backend file path: `tests/oneTimeMenuCatalog.test.js`
- Line number if possible: failures at 785, 806, 858, 972 during run
- Related dashboard file/API: dashboard publish/price flow relies on one-time customer catalog tests
- What is wrong: `npm run test:one-time-menu` fails four tests because order creation now requires an idempotency key.
- Why it matters: This suite is the strongest guard that dashboard-published menu changes behave correctly for customer orders.
- Admin/customer impact: Release confidence is reduced for stale product/option rejection and immutable order snapshot behavior.
- Suggested fix in plain English: Update tests to pass idempotency keys or adjust the contract if order creation should not require one.
- Type: Backend-only issue

## Medium Backend Issues

### Issue 5
- Severity: Medium
- Category: Pagination/list contract
- Backend file path: `src/services/orders/menuCatalogService.js`
- Line number if possible: 396-425
- Related dashboard file/API: `src/utils/menuResponseNormalizers.ts:687-724`
- What is wrong: Dashboard sends `page` and `limit`, but listModel ignores pagination and returns raw arrays.
- Why it matters: Dashboard tables are built around paginated responses.
- Admin/customer impact: Large catalogs can load all rows and display misleading pagination.
- Suggested fix in plain English: Add backend pagination metadata or document array-only list endpoints and adjust dashboard.
- Type: Dashboard/backend contract mismatch

### Issue 6
- Severity: Medium
- Category: RBAC contract
- Backend file path: `src/routes/dashboardMenu.js`
- Line number if possible: 8, 14, 26, 69
- Related dashboard file/API: `src/constants/routes.ts:95-100`
- What is wrong: All menu routes are restricted to admin/superadmin, while the dashboard route map exposes `/menu` to kitchen.
- Why it matters: Frontend/backend role policy is inconsistent.
- Admin/customer impact: Kitchen users hit 403 after the UI lets them in.
- Suggested fix in plain English: Align frontend route visibility with backend roles, or add backend read-only menu routes for kitchen.
- Type: Dashboard/backend contract mismatch

### Issue 7
- Severity: Medium
- Category: Upload contract
- Backend file path: `src/routes/admin.js`
- Line number if possible: 55-82
- Related dashboard file/API: `src/utils/fetchUploadImage.ts:3-25`
- What is wrong: Upload route is documented as `/admin/uploads/image` but also mounted under `/dashboard` by `src/routes/index.js`. The dashboard relies on the `/dashboard` mount.
- Why it matters: Route documentation and frontend contract are easy to desynchronize.
- Admin/customer impact: Image upload may break during deploy or API gateway routing changes.
- Suggested fix in plain English: Add an explicit documented `/dashboard/uploads/image` route/contract test or switch dashboard to `/admin/uploads/image`.
- Type: Dashboard/backend contract mismatch

## Low Backend Issues

### Issue 8
- Severity: Low
- Category: Logging/security
- Backend file path: `src/controllers/uploadController.js`, `src/middleware/imageUpload.js`
- Line number if possible: upload 498-510; middleware 577-590
- Related dashboard file/API: image upload forms
- What is wrong: Upload headers/body/file metadata are logged on every upload path.
- Why it matters: Logs may include operational metadata and noisy request details in production.
- Admin/customer impact: Increased log noise and potential privacy exposure for filenames.
- Suggested fix in plain English: Gate upload tracing behind a debug flag and avoid logging request bodies in production.
- Type: Backend-only issue

## Backend Dashboard Contract Matrix

| Feature | Backend route/controller | Backend-side risk | Status | Severity |
|---|---|---|---|---|
| Dashboard auth login/me/logout | `src/routes/dashboardAuth.js` | `/me` returns 200 `status:false` for unauthenticated optional auth | Acceptable with frontend handling | Low |
| Menu CRUD | `src/routes/dashboardMenu.js` | Broad coverage exists | Partial | Medium |
| Menu list pagination | `menuCatalogService.js:listModel` | Ignores `page`/`limit` | Mismatch | Medium |
| Publish menu | `menuCatalogService.js:934-953` | Publishes active catalog and snapshots public one-time shape | Partial | Medium |
| Rollback menu | `menuController.js:133-164`; service 964-1052 | Incomplete snapshot restore and nonstandard response | Risky | High |
| Duplicate product | `menuCatalogService.js:697-756` | Exists and sets duplicate inactive/unpublished | Match | Low |
| Product-specific option price | `menuCatalogService.js:891-905` | Update query omits `groupId` | Risky | High |
| Error shape | `errorResponse.js`; `menuController.js` custom returns | Some menu routes bypass standard shape | Partial | High |
| RBAC | `dashboardRoleMiddleware`; `dashboardMenu.js:8` | Backend stricter than frontend for kitchen | Mismatch | Medium |
| Upload | `adminRoutes` mounted under `/dashboard` and `/admin` | Documentation/path ambiguity | Partial | Medium |
| Published customer catalog | `getPublishedMenu`, `CatalogService` | Publish gate exists; one-time menu tests currently fail downstream order cases | Risky | High |

## Commands Run
- `npm test` in backend: passed, exit code 0, 57 meal planner tests passed, changed files: no.
- `npm run test:one-time-menu` in backend: failed, exit code 1, 4 idempotency-key-related failures, changed files: no.
- Multiple `rg`, `sed`, and `nl -ba` inspections in backend: completed, changed files: no.

## Final Backend Dashboard Contract Status
- Backend dashboard contract ready? No, not for full menu lifecycle release.
- Main blockers: rollback contract/snapshot safety, inconsistent error shape, product-specific option update query, failing one-time menu catalog contract tests.
- Minimum backend fixes before full dashboard/backend release: standardize menu errors, harden rollback, include `groupId` in product option override updates, resolve one-time menu test failures, document upload path.
