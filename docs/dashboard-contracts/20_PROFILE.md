# Screen Contract: 20_PROFILE

## 1. Screen Purpose
Provides operator profile retrieval, authentication checks, and session management.

## 2. Dashboard Route
`/profile`

## 3. Visible UI Requirements
* Displays logged-in operator details: Name, Email, Role (e.g. `superadmin`, `admin`, `cashier`, `courier`), and Status.
* Logout button.

## 4. Backend Endpoints
* `GET /api/dashboard/auth/me` (retrieves the active logged-in dashboard user details)
* `POST /api/dashboard/auth/logout` (session logout, client should discard JWT)

## 5. Request Parameters
* Authorization header with Bearer JWT token required.

## 6. Response Fields Required
* **Profile Response (`GET /api/dashboard/auth/me`):**
  * `status` (boolean): `true` if active session, `false` otherwise
  * `user` (object or null):
    * `id` (string, ObjectId)
    * `email` (string)
    * `name` (string)
    * `role` (string, e.g. `admin`, `superadmin`, `cashier`, `kitchen`, `courier`)
    * `isActive` (boolean)

## 7. Status
`NEEDS_TESTS` (The endpoint exists on the backend but lacks automated test coverage in the dashboard contract integration test suite).
