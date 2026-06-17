# Screen Contract: 11F_MENU_PREVIEW_RELEASE

## 1. Screen Purpose
Provides menu previewing, catalog validation, change diffing, version listing, menu publishing, and rollback capabilities.

## 2. Dashboard Route
`/menu` (Preview & Release tabs)

## 3. Visible UI Requirements
* Mobile Menu Preview frame.
* Version history list showing dates, notes, and publishing operator.
* Validation check panel showing error/warning counts and list of broken dependencies.
* Rollback confirmation modal.
* Release/Publish modal.

## 4. Backend Endpoints
* `GET /api/dashboard/menu/preview` (fetches a preview of the draft menu catalog)
* `GET /api/dashboard/menu/versions` (lists version history)
* `GET /api/dashboard/menu/diff` (gets differences between draft and published menu)
* `POST /api/dashboard/menu/publish` (releases/publishes the current draft catalog)
* `POST /api/dashboard/menu/rollback/:versionId` (restores catalog state from a previous snapshot)
* `POST /api/dashboard/menu/validate` (runs semantic checks on catalog integrity)

> [!WARNING]
> The frontend route map lists `/api/dashboard/menu/validation` as the validation endpoint. However, the backend expects `POST /api/dashboard/menu/validate`. The frontend must call the correct `/validate` route, or a routing adjustment is needed on the server.

## 5. Request Parameters
* **Publish/Release (`POST /api/dashboard/menu/publish`):**
  * `notes` (optional, string): Release description.
* **Rollback (`POST /api/dashboard/menu/rollback/:versionId`):**
  * `confirm` (required, boolean, must be `true`)
* **Validate (`POST /api/dashboard/menu/validate`):** No body required.

## 6. Response Fields Required
* **Validate Response (`POST /api/dashboard/menu/validate`):**
  * `status` (boolean): `true` if call succeeded.
  * `data` (object):
    * `ok` (boolean): `true` if menu has no validation errors.
    * `errors` (array of strings): High-priority errors (e.g. required customization group with no options).
    * `warnings` (array of strings): Low-priority warnings (e.g. extra weight price without extra weight unit).
    * `summary` (object): `{ categories, products, groups, options, activeProducts }`
* **Version List Response (`GET /api/dashboard/menu/versions`):**
  * `status` (boolean)
  * `data` (array of version objects):
    * `_id` (string, ObjectId)
    * `status` (string, e.g. `published`, `archived`)
    * `publishedAt` (string, ISO Date)
    * `publishedBy` (string, ObjectId)
    * `notes` (string)

## 7. Status
`READY_WITH_LIMITATIONS` (Validation, preview, and versions are fully functional and covered by tests. Rollbacks and diffs are functional but have more limited test coverage).
