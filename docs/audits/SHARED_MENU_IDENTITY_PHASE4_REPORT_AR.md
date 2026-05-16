> Status: Historical / audit reference. Do not use this as the current frontend or API implementation source of truth. For current frontend handoff docs, see `docs/frontend-handoff/`.

# Shared Menu Identity Suggestion Approval Report

## Files Changed
- `src/models/MenuIdentitySuggestion.js`: Added a new staging model for suggested mappings.
- `scripts/suggest-menu-identity-mappings.js`: Updated to write suggestions to the staging model instead of directly creating links.
- `src/controllers/dashboard/menuIdentityController.js`: Added endpoints for listing, viewing, approving, and rejecting suggestions.
- `src/routes/dashboardMenuIdentity.js`: Registered the new suggestion endpoints.
- `tests/menuIdentitySuggestionsApproval.test.js`: Added integration tests for the full approval workflow.
- `tests/menuIdentitySuggestions.test.js`: Updated and verified for the new staging behavior.
- `package.json`: Registered the new approval test script.
- `scripts/validate-backend.js`: Integrated the approval workflow into the backend validation suite.

## Endpoints Added
All endpoints require `dashboardAuthMiddleware` and `admin`/`superadmin` role.

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/dashboard/menu-identity-suggestions` | List pending/processed suggestions with pagination and filters. |
| `GET` | `/api/dashboard/menu-identity-suggestions/:id` | View detailed suggestion record. |
| `POST` | `/api/dashboard/menu-identity-suggestions/:id/approve` | Approve a suggestion to create/update identities and links. |
| `POST` | `/api/dashboard/menu-identity-suggestions/:id/reject` | Reject a suggestion (updates status only). |

## Approval Flow
1. **Suggestion Staging**: The CLI tool generates and writes suggestions to `MenuIdentitySuggestion` with `status: pending`.
2. **Review**: Administrators can view suggestions in the Dashboard API.
3. **Approval Action**:
   - Performs a **Conflict Check**: Ensures no linked source is already active in another identity.
   - Creates or finds the `SharedMenuIdentity`.
   - Creates `MenuIdentityLink` records for all proposed links.
   - Updates suggestion status to `approved` and logs the reviewer details.
4. **Audit**: All approvals are recorded in the `ActivityLog` for accountability.

## Safety Guards
- **Conflict Prevention**: Returns `409 Conflict` if a source model record is already linked elsewhere, preventing multi-mapping inconsistencies.
- **Idempotency**: Suggestions can only be approved/rejected once; subsequent attempts return `400 Bad Request`.
- **RBAC**: Strictly forbidden for non-admin roles (kitchen, courier, etc.).
- **Isolation**: Mobile and public order APIs remain completely unaware of the Mapping Layer.

## Tests
- Confirmed `403 Forbidden` for unauthorized roles.
- Verified successful approval creates both `SharedMenuIdentity` and `MenuIdentityLink`.
- Verified conflict detection when a product is already mapped.
- Verified that dry-run mode in the suggestion script still creates no database changes.

## What Did Not Change
- **Public API Contracts**: No changes to `/api/orders`, `/api/subscriptions`, or `/api/orders/menu`.
- **Runtime Persistence**: Core business logic still relies on direct model IDs.
- **Data Integrity**: Existing menu data remains untouched; only metadata links are created.
