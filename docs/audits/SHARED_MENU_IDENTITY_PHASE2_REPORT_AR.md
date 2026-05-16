> Status: Historical / audit reference. Do not use this as the current frontend or API implementation source of truth. For current frontend handoff docs, see `docs/frontend-handoff/`.

# Shared Menu Identity Dashboard Viewer Report

## Files Changed
- `src/controllers/dashboard/menuIdentityController.js`: New controller for read-only dashboard access.
- `src/routes/dashboardMenuIdentity.js`: New route file with dashboard authentication and role protection.
- `src/routes/index.js`: Registered mapping routes under `/api/dashboard`.
- `tests/dashboardMenuIdentity.test.js`: New integration tests for dashboard endpoints.
- `package.json`: Added `test:dashboard-menu-identity` script.
- `scripts/validate-backend.js`: Added dashboard mapping visibility check.

## Endpoints Added
All endpoints require `dashboardAuthMiddleware` and `admin`/`superadmin` role.

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/dashboard/menu-identities` | List canonical identities with pagination and filters (`key`, `type`, `isActive`). |
| `GET` | `/api/dashboard/menu-identities/:id` | View detailed identity record. |
| `GET` | `/api/dashboard/menu-identities/:id/links` | View all existing links for a specific identity, including source summaries. |
| `GET` | `/api/dashboard/menu-identity-links` | Global link audit list with filters (`channel`, `sourceModel`, `confidence`, `status`, `isActive`). |

## Security
- **Authentication**: JWT-based dashboard authentication required via `dashboardAuthMiddleware`.
- **Authorization**: Strictly restricted to `admin` and `superadmin` roles using `dashboardRoleMiddleware`.
- **Internal Audit Path**: Mounted `/api/dashboard/menu-identities-audit` as a secondary mounting point for easier resource grouping in audit tools.

## Read-Only Guarantee
- Endpoints only use `.find()` and `.findById()` with `.lean()` to avoid unintended side effects.
- No `POST`, `PUT`, `PATCH`, or `DELETE` methods were registered for these identity resources.
- Controllers do not import any service that performs data modification.

## Tests
- **Auth/Role Verification**: Confirmed 401 for missing tokens and 403 for unauthorized roles (e.g., kitchen/courier).
- **Listing/Detail Verification**: Confirmed correct response shapes and pagination metadata.
- **Source Resolution**: Verified that links include the `sourceDisplayName` (e.g., product name) fetched from the linked model.

## What Did Not Change
- **Mobile APIs**: No changes to `/api/orders`, `/api/subscriptions`, or `/api/orders/menu`.
- **Runtime Logic**: Existing order and subscription services continue to use legacy model IDs directly.
- **Data Integrity**: Phase 2 remains non-destructive and doesn't mutate existing data.
