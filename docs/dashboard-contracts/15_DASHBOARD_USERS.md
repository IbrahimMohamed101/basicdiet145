# Screen Contract: 15_DASHBOARD_USERS

## 1. Screen Purpose
Provides CRUD operations, password reset, and access control role assignments for admin and kitchen staff dashboard accounts.

## 2. Dashboard Route
`/dashboard-users`

## 3. Visible UI Requirements
* Table of dashboard accounts showing: Name, Email, Role (superadmin, admin, kitchen, courier, cashier), Status, Registration date.
* Add/Edit user form: Name, Email, Role selection dropdown, password.
* "Reset Password" trigger option.

## 4. Backend Endpoints
* `GET /api/dashboard/dashboard-users` (lists dashboard users)
* `GET /api/dashboard/dashboard-users/:id` (fetches a single user detail)
* `POST /api/dashboard/dashboard-users` (creates dashboard user)
* `PUT /api/dashboard/dashboard-users/:id` (updates user details / roles)
* `DELETE /api/dashboard/dashboard-users/:id` (removes user account)
* `POST /api/dashboard/dashboard-users/:id/reset-password` (forces password reset)

## 5. Request Parameters
* Body (Create/Update):
  * `email` (required, string, unique email address)
  * `role` (required, string, values: `superadmin`, `admin`, `kitchen`, `courier`, `cashier`)
  * `password` (required for create, optional for update, string)
  * `name` (optional, string)

## 6. Response Fields Required
* `status` (boolean): success status.
* `data` (user object or array of user objects):
  * `id` (string)
  * `email` (string)
  * `role` (string)
  * `name` (string)
  * `createdAt` (string)

## 7. Field Dictionary
* `role`: Determines the dashboard screens and action mutations the account has access to. Roles must be checked by the `dashboardRoleMiddleware`.

## 8. Classification
`SECURITY_CRITICAL`

## 9. Frontend Restrictions
* **Password Validation**: Strength checks can be run on the client, but the hash generation is strictly done on the backend.
* **Role Guards**: The frontend must hide buttons or menus for unauthorized roles, but must rely on backend HTTP 403 Forbidden status codes for security enforcement.

## 10. Backend Acceptance Criteria
* Password hashes must be salted and encrypted using bcrypt (do not store raw passwords).
* Prevent deletion of the final `superadmin` account.

## 11. Contract Tests Required
* List endpoint returns users.
* Reject creating duplicate emails (returns 409).

## 12. Known Risks
* Compromising dashboard accounts grants direct control over financial configurations. Strong passwords and role limitation are required.

## 13. Status
`READY`
