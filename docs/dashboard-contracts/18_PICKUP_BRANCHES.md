# Screen Contract: 18_PICKUP_BRANCHES

## 1. Screen Purpose
Provides CRUD operations for self-pickup branch locations. Operators configure the list of branches, their names (Ar/En), addresses, maps coordinates, and active status.

## 2. Dashboard Route
`/pickup-branches`

## 3. Visible UI Requirements
* Table of pickup branches showing: Branch Name (Ar/En), Address (Ar/En), Coordinates, Status (Active/Inactive).
* Modals to Create, Edit, or delete branches.

## 4. Backend Endpoints
* `GET /api/dashboard/settings` — Lists all settings keys and values, including `pickup_locations`.
* `PATCH /api/dashboard/settings` — Bulk-updates **allowed** settings keys.

> ℹ️ **Backend Support**: `pickup_locations` is fully supported on `PATCH /api/dashboard/settings`. Incoming arrays are validated: each item must be an object with unique `id`, unique `name` (with non-empty bilingual `ar` and `en` values), and non-empty `address` (with bilingual `ar` and `en` values). The backend automatically normalizes the input, generating backward-compatibility fields/aliases and validating coordinates (`latitude`/`longitude`) if provided.

## 5. Request Parameters
* Body (PATCH /settings):
  * `pickup_locations` (required, array of branch objects):
    * `id` (required, string, unique branch ID)
    * `name` (required, object): `{ ar: string, en: string }`
    * `address` (required, object): `{ ar: string, en: string }`
    * `isActive` (required, boolean)
    * `latitude` (optional, number)
    * `longitude` (optional, number)

## 6. Response Fields Required
* `status` (boolean): success status.
* `data` (settings object):
  * `pickup_locations` (array of branch objects)

## 7. Field Dictionary
* `pickup_locations`: List of branches eligible for the client to select when choosing `deliveryMode: "pickup"`.
* `isActive`: If false, the branch is hidden from the mobile app's signup/modification selector.

## 8. Classification
`OPERATIONAL`

## 9. Frontend Restrictions
* **Id generation**: When adding a new branch location, the frontend should generate a random unique string (e.g. UUID) or let the backend generate it. The backend stores the array in a single settings row.

## 10. Backend Acceptance Criteria
* Validate coordinates if supplied.
* Ensure branch names and IDs are unique in the collection.

## 11. Contract Tests Required
* Get settings returns `pickup_locations` array.
* Bulk update settings successfully updates branch array.

## 12. Known Risks
* Deleting branches that are actively referenced as the default pickup location for a client's subscription can cause runtime issues. The frontend should prompt warning confirmation before delete.

## 13. Status
`READY`

> **Reason**: The `PATCH /api/dashboard/settings` endpoint has been fixed to allow the `pickup_locations` key, fully validate the branch list structure, and save it successfully to the database. Integration tests are in place to prevent regressions.
