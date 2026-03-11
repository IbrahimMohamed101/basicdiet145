# Postman Endpoint Guide + Swagger Verification

## Purpose
- This file lists all API endpoints from current `swagger.yaml` with practical testing details for Postman.
- It also records route-vs-swagger verification status.

## Quick Setup (Postman)
1. Import OpenAPI file from `http://localhost:3000/api-docs/swagger.yaml` (or local `swagger.yaml`).
2. Create environment variables: `baseUrl`, `appToken`, `dashboardToken`.
3. Use `{{baseUrl}}` as `http://localhost:3000` in local.
4. For app-protected endpoints: `Authorization: Bearer {{appToken}}`.
5. For dashboard/admin/courier/kitchen endpoints: `Authorization: Bearer {{dashboardToken}}`.

## Swagger Verification (Code vs Swagger)
- Verification date: 2026-03-08
- Runtime code endpoints found: `153`
- Swagger documented operations found: `154`
- Missing in Swagger from runtime routes: `0`
- Extra in Swagger: `GET /api-docs` (served by `app.use` middleware route).

## Endpoint Details

## /

### GET /
- Summary: Root health endpoint
- Description: Simple deployment smoke-test endpoint.
- Tags: `System`
- Auth: None
- Parameters: None
- Request body: None
- Responses:
  - `200`: Service is running.

## /api-docs

### GET /api-docs
- Summary: Swagger UI
- Description: Serves Swagger UI configured to load `/api-docs/swagger.yaml`.
- Tags: `System`
- Auth: None
- Parameters: None
- Request body: None
- Responses:
  - `200`: HTML page.

## /api-docs/swagger.yaml

### GET /api-docs/swagger.yaml
- Summary: Raw Swagger YAML
- Description: Serves the OpenAPI spec file used by Swagger UI.
- Tags: `System`
- Auth: None
- Parameters: None
- Request body: None
- Responses:
  - `200`: YAML document.

## /api/addons

### GET /api/addons
- Summary: List active addons
- Description: Returns active addons only, sorted by `sortOrder ASC`, then `createdAt DESC`. Localized fields are resolved with `Accept-Language`.
- Tags: `Menu`
- Auth: None
- Parameters:
  - `header.Accept-Language` (string, optional) (ref: `AcceptLanguage`) - Preferred language. Runtime resolves to `ar` or `en`; unknown values fall back to `ar`.
- Request body: None
- Responses:
  - `200`: Addons list.

## /api/admin/addons

### GET /api/admin/addons
- Summary: List addons (admin)
- Description: Requires dashboard auth with `admin` role. Returns all addons (active and inactive), sorted by `sortOrder ASC`, `createdAt DESC`.
- Tags: `Admin`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters: None
- Request body: None
- Responses:
  - `200`: Addons list.
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)

### POST /api/admin/addons
- Summary: Create addon
- Description: Requires dashboard auth with `admin` role.
- Tags: `Admin`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters: None
- Request body required: yes
- Required body fields: `name`, `priceHalala`
- Body fields: `name`, `description`, `imageUrl`, `priceHalala`, `currency`, `type`, `isActive`, `sortOrder`
- Responses:
  - `201`: Created.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)

## /api/admin/addons/{id}

### GET /api/admin/addons/{id}
- Summary: Get addon (admin)
- Description: Requires dashboard auth with `admin` role.
- Tags: `Admin`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required)
- Request body: None
- Responses:
  - `200`: Addon.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)

### PUT /api/admin/addons/{id}
- Summary: Update addon
- Description: Requires dashboard auth with `admin` role.
- Tags: `Admin`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required)
- Request body required: yes
- Required body fields: `name`, `priceHalala`
- Body fields: `name`, `description`, `imageUrl`, `priceHalala`, `currency`, `type`, `isActive`, `sortOrder`
- Responses:
  - `200`: Updated.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)

### DELETE /api/admin/addons/{id}
- Summary: Delete addon
- Description: Requires dashboard auth with `admin` role.
- Tags: `Admin`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required)
- Request body: None
- Responses:
  - `200`: Deleted.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)

## /api/admin/addons/{id}/clone

### POST /api/admin/addons/{id}/clone
- Summary: Clone addon
- Description: Requires dashboard auth with `admin` role.
- Tags: `Admin`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required)
- Request body: None
- Responses:
  - `201`: Cloned.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)

## /api/admin/addons/{id}/sort

### PATCH /api/admin/addons/{id}/sort
- Summary: Update addon sort order
- Description: Requires dashboard auth with `admin` role.
- Tags: `Admin`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required)
- Request body required: yes
- Required body fields: `sortOrder`
- Body fields: `sortOrder`
- Responses:
  - `200`: Sort order updated.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)

## /api/admin/addons/{id}/toggle

### PATCH /api/admin/addons/{id}/toggle
- Summary: Toggle addon active state
- Description: Requires dashboard auth with `admin` role.
- Tags: `Admin`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required)
- Request body: None
- Responses:
  - `200`: Toggled.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)

## /api/admin/dashboard-users

### GET /api/admin/dashboard-users
- Summary: List dashboard users
- Description: Returns all dashboard users sorted by creation date descending.
- Tags: `Admin (Dashboard)`, `Users`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters: None
- Request body: None
- Responses:
  - `200`: Dashboard users.
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)

### POST /api/admin/dashboard-users
- Summary: Create dashboard user
- Description: Creates dashboard user with `email` and role (`admin|kitchen|courier`).
- Tags: `Admin (Dashboard)`, `Users`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters: None
- Request body required: yes
- Required body fields: `email`, `role`
- Body fields: `email`, `role`
- Responses:
  - `201`: Dashboard user created.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)

## /api/admin/logs

### GET /api/admin/logs
- Summary: List activity logs
- Description: Returns paginated activity logs with optional filter parameters.
- Tags: `Admin (Dashboard)`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `query.entityType` (string, optional)
  - `query.entityId` (string, optional)
  - `query.action` (string, optional)
  - `query.from` (string, optional)
  - `query.to` (string, optional)
  - `query.byRole` (string, optional)
  - `query.page` (integer, optional) (ref: `Page`)
  - `query.limit` (integer, optional) (ref: `Limit`)
- Request body: None
- Responses:
  - `200`: Paginated logs.
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)

## /api/admin/notification-logs

### GET /api/admin/notification-logs
- Summary: List notification logs
- Description: Returns paginated notification dispatch logs with optional filters.
- Tags: `Notifications`, `Admin (Dashboard)`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `query.userId` (string, optional)
  - `query.from` (string, optional)
  - `query.to` (string, optional)
  - `query.page` (integer, optional) (ref: `Page`)
  - `query.limit` (integer, optional) (ref: `Limit`)
- Request body: None
- Responses:
  - `200`: Paginated notification logs.
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)

## /api/admin/plans

### GET /api/admin/plans
- Summary: List plans (admin)
- Description: Returns plans with nested grams/meals options, including inactive entries. Supports list-screen helpers in the same endpoint: `search`/`q` for fuzzy search and `status`/`isActive` for active-state filtering. The response also includes `summary` and `meta` beside `data`.
- Tags: `Admin (Dashboard)`, `Plans`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - Query `search` or `q` (optional): fuzzy search by id, Arabic/English name, days count, grams, or meals per day
  - Query `status` (optional): `active`, `inactive`, or `all`
  - Query `isActive` (optional): alias of `status` and accepts `true`/`false`/`1`/`0`
- Request body: None
- Responses:
  - `200`: Plan list.
  - `400`: Invalid query parameter value. (ref: `ValidationError`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)

### POST /api/admin/plans
- Summary: Create plan
- Description: Admin-only. Creates a nested plan (`daysCount -> gramsOptions -> mealsOptions`). Validation notes: - all prices are integer halala values (`priceHalala`, `compareAtHalala`) - currency must be `SAR`
- Tags: `Admin (Dashboard)`, `Plans`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters: None
- Request body required: yes
- Body schema: `#/components/schemas/PlanCreateRequest`
- Example body:
```json
{
  "name": {
    "ar": "26 يوم",
    "en": "26 Days"
  },
  "daysCount": 26,
  "currency": "SAR",
  "sortOrder": 1,
  "isActive": true,
  "skipAllowanceCompensatedDays": 3,
  "freezePolicy": {
    "enabled": true,
    "maxDays": 31,
    "maxTimes": 1
  },
  "gramsOptions": [
    {
      "grams": 100,
      "sortOrder": 0,
      "isActive": true,
      "mealsOptions": [
        {
          "mealsPerDay": 1,
          "sortOrder": 0,
          "isActive": true,
          "priceHalala": 259900,
          "compareAtHalala": 289900
        },
        {
          "mealsPerDay": 2,
          "sortOrder": 1,
          "isActive": true,
          "priceHalala": 310000,
          "compareAtHalala": 300000
        }
      ]
    }
  ]
}
```
- Responses:
  - `201`: Plan created.
  - `400`: Validation error.
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)

## /api/admin/plans/{id}

### GET /api/admin/plans/{id}
- Summary: Get plan (admin)
- Description: Returns a full plan payload with nested grams/meals options.
- Tags: `Admin (Dashboard)`, `Plans`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `PlanId`) - Plan Mongo ObjectId.
- Request body: None
- Responses:
  - `200`: Plan details.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)

### PUT /api/admin/plans/{id}
- Summary: Update plan
- Description: Replaces plan payload with the provided nested plan data.
- Tags: `Admin (Dashboard)`, `Plans`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `PlanId`) - Plan Mongo ObjectId.
- Request body required: yes
- Body schema: `#/components/schemas/PlanCreateRequest`
- Responses:
  - `200`: Plan updated.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)
  - `409`: Resource state conflict. (ref: `Conflict`)

### DELETE /api/admin/plans/{id}
- Summary: Delete plan
- Tags: `Admin (Dashboard)`, `Plans`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `PlanId`) - Plan Mongo ObjectId.
- Request body: None
- Responses:
  - `200`: Plan deleted.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)

## /api/admin/plans/{id}/clone

### POST /api/admin/plans/{id}/clone
- Summary: Clone plan
- Description: Clones a plan with nested grams/meals options.
- Tags: `Admin (Dashboard)`, `Plans`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `PlanId`) - Plan Mongo ObjectId.
- Request body: None
- Responses:
  - `201`: Plan cloned.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)
  - `409`: Resource state conflict. (ref: `Conflict`)

## /api/admin/plans/{id}/grams/{grams}

### DELETE /api/admin/plans/{id}/grams/{grams}
- Summary: Delete grams row
- Tags: `Admin (Dashboard)`, `Plans`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `PlanId`) - Plan Mongo ObjectId.
  - `path.grams` (integer, required)
- Request body: None
- Responses:
  - `200`: Grams row deleted.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)

## /api/admin/plans/{id}/grams/{grams}/meals/{mealsPerDay}

### DELETE /api/admin/plans/{id}/grams/{grams}/meals/{mealsPerDay}
- Summary: Delete meals option from grams row
- Tags: `Admin (Dashboard)`, `Plans`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `PlanId`) - Plan Mongo ObjectId.
  - `path.grams` (integer, required)
  - `path.mealsPerDay` (integer, required)
- Request body: None
- Responses:
  - `200`: Meals option deleted.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)

## /api/admin/plans/{id}/grams/{grams}/meals/{mealsPerDay}/sort

### PATCH /api/admin/plans/{id}/grams/{grams}/meals/{mealsPerDay}/sort
- Summary: Update meals option sort order
- Tags: `Admin (Dashboard)`, `Plans`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `PlanId`) - Plan Mongo ObjectId.
  - `path.grams` (integer, required)
  - `path.mealsPerDay` (integer, required)
- Request body required: yes
- Required body fields: `sortOrder`
- Body fields: `sortOrder`
- Responses:
  - `200`: Meals option sort order updated.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)

## /api/admin/plans/{id}/grams/{grams}/meals/{mealsPerDay}/toggle

### PATCH /api/admin/plans/{id}/grams/{grams}/meals/{mealsPerDay}/toggle
- Summary: Toggle meals option active state
- Tags: `Admin (Dashboard)`, `Plans`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `PlanId`) - Plan Mongo ObjectId.
  - `path.grams` (integer, required)
  - `path.mealsPerDay` (integer, required)
- Request body: None
- Responses:
  - `200`: Meals option toggled.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)

## /api/admin/plans/{id}/grams/{grams}/meals/clone

### POST /api/admin/plans/{id}/grams/{grams}/meals/clone
- Summary: Clone meals option within a grams row
- Tags: `Admin (Dashboard)`, `Plans`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `PlanId`) - Plan Mongo ObjectId.
  - `path.grams` (integer, required)
- Request body required: yes
- Required body fields: `mealsPerDay`, `newMealsPerDay`
- Body fields: `mealsPerDay`, `newMealsPerDay`
- Responses:
  - `201`: Meals option cloned.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)
  - `409`: Resource state conflict. (ref: `Conflict`)

## /api/admin/plans/{id}/grams/{grams}/meals

### POST /api/admin/plans/{id}/grams/{grams}/meals
- Summary: Create meals option within a grams row
- Description: Adds a new meals option to an existing grams row without sending the full plan payload.
- Tags: `Admin (Dashboard)`, `Plans`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `PlanId`) - Plan Mongo ObjectId.
  - `path.grams` (integer, required)
- Request body required: yes
- Required body fields: `mealsPerDay`, `priceHalala`, `compareAtHalala`
- Body fields: `mealsPerDay`, `priceHalala`, `compareAtHalala`, `sortOrder`, `isActive`
- Responses:
  - `201`: Meals option created.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)
  - `409`: Resource state conflict. (ref: `Conflict`)

## /api/admin/plans/{id}/grams/{grams}/sort

### PATCH /api/admin/plans/{id}/grams/{grams}/sort
- Summary: Update grams row sort order
- Tags: `Admin (Dashboard)`, `Plans`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `PlanId`) - Plan Mongo ObjectId.
  - `path.grams` (integer, required)
- Request body required: yes
- Required body fields: `sortOrder`
- Body fields: `sortOrder`
- Responses:
  - `200`: Grams sort order updated.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)

## /api/admin/plans/{id}/grams/{grams}/toggle

### PATCH /api/admin/plans/{id}/grams/{grams}/toggle
- Summary: Toggle grams row active state
- Tags: `Admin (Dashboard)`, `Plans`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `PlanId`) - Plan Mongo ObjectId.
  - `path.grams` (integer, required)
- Request body: None
- Responses:
  - `200`: Grams row toggled.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)

## /api/admin/plans/{id}/grams/clone

### POST /api/admin/plans/{id}/grams/clone
- Summary: Clone grams row
- Description: Duplicates an existing grams option into a new grams value.
- Tags: `Admin (Dashboard)`, `Plans`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `PlanId`) - Plan Mongo ObjectId.
- Request body required: yes
- Required body fields: `grams`, `newGrams`
- Body fields: `grams`, `newGrams`
- Responses:
  - `201`: Grams row cloned.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)
  - `409`: Resource state conflict. (ref: `Conflict`)

## /api/admin/plans/{id}/grams

### POST /api/admin/plans/{id}/grams
- Summary: Create grams row
- Description: Adds a new grams option with nested meals options to an existing plan without sending the full plan payload.
- Tags: `Admin (Dashboard)`, `Plans`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `PlanId`) - Plan Mongo ObjectId.
- Request body required: yes
- Required body fields: `grams`, `mealsOptions`
- Body fields: `grams`, `sortOrder`, `isActive`, `mealsOptions`
- Responses:
  - `201`: Grams row created.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)
  - `409`: Resource state conflict. (ref: `Conflict`)

## /api/admin/plans/{id}/sort

### PATCH /api/admin/plans/{id}/sort
- Summary: Update plan sort order
- Tags: `Admin (Dashboard)`, `Plans`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `PlanId`) - Plan Mongo ObjectId.
- Request body required: yes
- Required body fields: `sortOrder`
- Body fields: `sortOrder`
- Responses:
  - `200`: Sort order updated.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)

## /api/admin/plans/{id}/toggle

### PATCH /api/admin/plans/{id}/toggle
- Summary: Toggle plan active state
- Tags: `Admin (Dashboard)`, `Plans`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `PlanId`) - Plan Mongo ObjectId.
- Request body: None
- Responses:
  - `200`: Plan toggled.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)

## /api/admin/premium-meals

### GET /api/admin/premium-meals
- Summary: List premium meals (admin)
- Description: Requires dashboard auth with `admin` role. Returns all premium meals (active and inactive), sorted by `sortOrder ASC`, `createdAt DESC`.
- Tags: `Admin`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters: None
- Request body: None
- Responses:
  - `200`: Premium meals list.
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)

### POST /api/admin/premium-meals
- Summary: Create premium meal
- Description: Requires dashboard auth with `admin` role.
- Tags: `Admin`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters: None
- Request body required: yes
- Required body fields: `name`, `extraFeeHalala`
- Body fields: `name`, `description`, `imageUrl`, `currency`, `extraFeeHalala`, `isActive`, `sortOrder`
- Responses:
  - `201`: Created.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)

## /api/admin/premium-meals/{id}

### GET /api/admin/premium-meals/{id}
- Summary: Get premium meal (admin)
- Description: Requires dashboard auth with `admin` role.
- Tags: `Admin`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required)
- Request body: None
- Responses:
  - `200`: Premium meal.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)

### PUT /api/admin/premium-meals/{id}
- Summary: Update premium meal
- Description: Requires dashboard auth with `admin` role.
- Tags: `Admin`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required)
- Request body required: yes
- Required body fields: `name`, `extraFeeHalala`
- Body fields: `name`, `description`, `imageUrl`, `currency`, `extraFeeHalala`, `isActive`, `sortOrder`
- Responses:
  - `200`: Updated.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)

### DELETE /api/admin/premium-meals/{id}
- Summary: Delete premium meal
- Description: Requires dashboard auth with `admin` role.
- Tags: `Admin`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required)
- Request body: None
- Responses:
  - `200`: Deleted.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)

## /api/admin/premium-meals/{id}/clone

### POST /api/admin/premium-meals/{id}/clone
- Summary: Clone premium meal
- Description: Requires dashboard auth with `admin` role.
- Tags: `Admin`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required)
- Request body: None
- Responses:
  - `201`: Cloned.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)

## /api/admin/premium-meals/{id}/sort

### PATCH /api/admin/premium-meals/{id}/sort
- Summary: Update premium meal sort order
- Description: Requires dashboard auth with `admin` role.
- Tags: `Admin`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required)
- Request body required: yes
- Required body fields: `sortOrder`
- Body fields: `sortOrder`
- Responses:
  - `200`: Sort order updated.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)

## /api/admin/premium-meals/{id}/toggle

### PATCH /api/admin/premium-meals/{id}/toggle
- Summary: Toggle premium meal active state
- Description: Requires dashboard auth with `admin` role.
- Tags: `Admin`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required)
- Request body: None
- Responses:
  - `200`: Toggled.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)

## /api/admin/salad-ingredients

### POST /api/admin/salad-ingredients
- Summary: Create salad ingredient
- Description: Creates an ingredient; supports both new multilingual and legacy name fields.
- Tags: `Admin`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters: None
- Request body required: yes
- Body fields: `name`, `name_ar`, `name_en`, `price`, `calories`, `maxQuantity`
- Responses:
  - `201`: Created.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)

## /api/admin/salad-ingredients/{id}

### PATCH /api/admin/salad-ingredients/{id}
- Summary: Update salad ingredient
- Description: Partially updates ingredient fields, including per-language name keys.
- Tags: `Admin`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `IngredientId`) - Mongo ObjectId.
- Request body required: yes
- Body fields: `name`, `name_ar`, `name_en`, `price`, `calories`, `maxQuantity`, `isActive`
- Responses:
  - `200`: Updated.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)

## /api/admin/salad-ingredients/{id}/toggle

### PATCH /api/admin/salad-ingredients/{id}/toggle
- Summary: Toggle salad ingredient active state
- Description: Flips ingredient `isActive` between true and false.
- Tags: `Admin`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `IngredientId`) - Mongo ObjectId.
- Request body: None
- Responses:
  - `200`: Toggled.
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)

## /api/admin/settings/cutoff

### PUT /api/admin/settings/cutoff
- Summary: Update cutoff time
- Description: Admin-only.
- Tags: `Admin (Dashboard)`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters: None
- Request body required: yes
- Required body fields: `time`
- Body fields: `time`
- Responses:
  - `200`: Updated.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)

## /api/admin/settings/delivery-windows

### PUT /api/admin/settings/delivery-windows
- Summary: Update delivery windows
- Description: Sets the allowed delivery windows used by checkout validations.
- Tags: `Admin (Dashboard)`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters: None
- Request body required: yes
- Required body fields: `windows`
- Body fields: `windows`
- Responses:
  - `200`: Updated.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)

## /api/admin/settings/premium-price

### PUT /api/admin/settings/premium-price
- Summary: Update premium meal price
- Description: Sets premium price setting used by subscription pricing logic.
- Tags: `Admin (Dashboard)`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters: None
- Request body required: yes
- Required body fields: `price`
- Body fields: `price`
- Responses:
  - `200`: Updated.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)

## /api/admin/settings/skip-allowance

### PUT /api/admin/settings/skip-allowance
- Summary: Update global skip allowance
- Description: Sets global skip allowance setting value.
- Tags: `Admin (Dashboard)`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters: None
- Request body required: yes
- Required body fields: `days`
- Body fields: `days`
- Responses:
  - `200`: Updated.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)

## /api/admin/trigger-cutoff

### POST /api/admin/trigger-cutoff
- Summary: Trigger cutoff job immediately
- Description: Admin-only manual trigger for daily cutoff automation.
- Tags: `Admin (Dashboard)`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters: None
- Request body: None
- Responses:
  - `200`: Job completed.
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `500`: Trigger failed.

## /api/app/login

### POST /api/app/login
- Summary: App login step (request OTP)
- Description: Same OTP request behavior as `/api/auth/otp/request`.
- Tags: `Auth (App)`
- Auth: None
- Parameters: None
- Request body required: yes
- Required body fields: `phoneE164`
- Body fields: `phoneE164`
- Responses:
  - `200`: OTP sent.
  - `400`: Bad request. (ref: `BadRequest`)
  - `429`: Rate limit or OTP cooldown exceeded. (ref: `TooManyRequests`)
  - `500`: Internal error. (ref: `Internal`)

## /api/app/register

### POST /api/app/register
- Summary: Complete app profile registration
- Description: Requires authenticated app token and returns a refreshed app access token.
- Tags: `Auth (App)`
- Auth: Bearer app token (`Authorization: Bearer <token>`)
- Parameters: None
- Request body required: yes
- Required body fields: `fullName`
- Body fields: `fullName`, `phoneE164`, `email`
- Responses:
  - `200`: Profile registered.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `500`: Internal error. (ref: `Internal`)

## /api/auth/device-token

### POST /api/auth/device-token
- Summary: Attach mobile device token to authenticated user
- Description: Adds an FCM token to `User.fcmTokens` with `$addToSet` semantics.
- Tags: `Auth (App)`, `Users`
- Auth: Bearer app token (`Authorization: Bearer <token>`)
- Parameters: None
- Request body required: yes
- Required body fields: `token`
- Body fields: `token`
- Responses:
  - `200`: Token saved.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)

## /api/auth/otp/request

### POST /api/auth/otp/request
- Summary: Request OTP over WhatsApp
- Description: Rate-limited endpoint that sends OTP to `phoneE164`.
- Tags: `Auth (App)`
- Auth: None
- Parameters: None
- Request body required: yes
- Required body fields: `phoneE164`
- Body fields: `phoneE164`
- Responses:
  - `200`: OTP sent.
  - `400`: Invalid phone input.
  - `429`: OTP cooldown or rate-limit exceeded.
  - `500`: Internal error. (ref: `Internal`)

## /api/auth/otp/verify

### POST /api/auth/otp/verify
- Summary: Verify OTP and issue app access token
- Description: Verifies OTP and returns JWT (`tokenType=app_access`) plus normalized app user profile.
- Tags: `Auth (App)`
- Auth: None
- Parameters: None
- Request body required: yes
- Required body fields: `phoneE164`, `otp`
- Body fields: `phoneE164`, `otp`
- Responses:
  - `200`: Verified.
  - `400`: Invalid input or expired/missing OTP.
  - `401`: Invalid OTP.
  - `429`: OTP attempts exceeded.
  - `500`: Internal error. (ref: `Internal`)

## /api/courier/deliveries/{id}/arriving-soon

### PUT /api/courier/deliveries/{id}/arriving-soon
- Summary: Mark delivery as arriving soon
- Description: Sets delivery status to `out_for_delivery` and sends an arriving-soon notification.
- Tags: `Deliveries / Courier`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `DeliveryId`) - Mongo ObjectId.
- Request body: None
- Responses:
  - `200`: Updated.
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)

## /api/courier/deliveries/{id}/cancel

### PUT /api/courier/deliveries/{id}/cancel
- Summary: Cancel delivery
- Description: Applies skip compensation rules for linked subscription day.
- Tags: `Deliveries / Courier`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `DeliveryId`) - Mongo ObjectId.
- Request body: None
- Responses:
  - `200`: Cancelled.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)
  - `500`: Internal error. (ref: `Internal`)

## /api/courier/deliveries/{id}/delivered

### PUT /api/courier/deliveries/{id}/delivered
- Summary: Mark delivery as delivered
- Description: Fulfills the subscription day and sends delivered notification with dedupe safeguards.
- Tags: `Deliveries / Courier`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `DeliveryId`) - Mongo ObjectId.
- Request body: None
- Responses:
  - `200`: Marked delivered (idempotent when already delivered).
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)
  - `409`: Resource state conflict. (ref: `Conflict`)
  - `500`: Internal error. (ref: `Internal`)

## /api/courier/deliveries/today

### GET /api/courier/deliveries/today
- Summary: List today's subscription deliveries
- Description: Requires `courier` or `admin` role.
- Tags: `Deliveries / Courier`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters: None
- Request body: None
- Responses:
  - `200`: Delivery list.
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)

## /api/courier/orders/{id}/cancel

### PUT /api/courier/orders/{id}/cancel
- Summary: Cancel one-time order
- Description: Transitions one-time order to `canceled` when transition rules allow.
- Tags: `Deliveries / Courier`, `Orders`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `OrderId`) - Mongo ObjectId.
- Request body: None
- Responses:
  - `200`: Cancelled.
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)
  - `409`: Resource state conflict. (ref: `Conflict`)

## /api/courier/orders/{id}/delivered

### PUT /api/courier/orders/{id}/delivered
- Summary: Mark one-time order delivered
- Description: Transitions order to `fulfilled` when transition rules allow.
- Tags: `Deliveries / Courier`, `Orders`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `OrderId`) - Mongo ObjectId.
- Request body: None
- Responses:
  - `200`: Delivered.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)
  - `409`: Resource state conflict. (ref: `Conflict`)

## /api/courier/orders/today

### GET /api/courier/orders/today
- Summary: List today's one-time delivery orders
- Description: Lists today's one-time orders where `deliveryMode=delivery`.
- Tags: `Deliveries / Courier`, `Orders`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters: None
- Request body: None
- Responses:
  - `200`: Order list.
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)

## /api/custom-salads/price

### POST /api/custom-salads/price
- Summary: Preview custom salad price
- Description: Calculates and returns a custom salad pricing snapshot from selected ingredients.
- Tags: `Meals / Menu`
- Auth: Bearer app token (`Authorization: Bearer <token>`)
- Parameters: None
- Request body required: yes
- Required body fields: `ingredients`
- Body fields: `ingredients`
- Responses:
  - `200`: Price snapshot.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `404`: Resource not found. (ref: `NotFound`)

## /api/dashboard/auth/login

### POST /api/dashboard/auth/login
- Summary: Dashboard login with email and password
- Description: Returns dashboard access JWT (`tokenType=dashboard_access`).
- Tags: `Auth (Dashboard)`
- Auth: None
- Parameters: None
- Request body required: yes
- Required body fields: `email`, `password`
- Body fields: `email`, `password`
- Responses:
  - `200`: Authenticated.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)
  - `423`: Account temporarily locked.
  - `429`: Rate limit or OTP cooldown exceeded. (ref: `TooManyRequests`)

## /api/dashboard/auth/logout

### POST /api/dashboard/auth/logout
- Summary: Dashboard logout
- Description: Stateless JWT logout. Server-side token revocation is not implemented.
- Tags: `Auth (Dashboard)`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters: None
- Request body: None
- Responses:
  - `200`: Logged out (no-op for stateless JWT).
  - `401`: Missing or invalid token. (ref: `Unauthorized`)

## /api/dashboard/auth/me

### GET /api/dashboard/auth/me
- Summary: Get authenticated dashboard user profile
- Tags: `Auth (Dashboard)`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters: None
- Request body: None
- Responses:
  - `200`: Current dashboard user.
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `404`: Resource not found. (ref: `NotFound`)

## /api/kitchen/days/{date}

### GET /api/kitchen/days/{date}
- Summary: List kitchen workload for subscription days
- Description: Requires `kitchen` or `admin` role.
- Tags: `Kitchen`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.date` (string, required) (ref: `KsaDate`) - KSA date string in `YYYY-MM-DD` format.
- Request body: None
- Responses:
  - `200`: Day workload.
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)

## /api/kitchen/orders/{date}

### GET /api/kitchen/orders/{date}
- Summary: List one-time orders by date
- Description: Lists one-time orders scheduled for the provided KSA date.
- Tags: `Kitchen`, `Orders`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.date` (string, required) (ref: `KsaDate`) - KSA date string in `YYYY-MM-DD` format.
- Request body: None
- Responses:
  - `200`: Orders for date.
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)

## /api/kitchen/orders/{id}/out-for-delivery

### POST /api/kitchen/orders/{id}/out-for-delivery
- Summary: Transition one-time order to out_for_delivery
- Description: Valid only for delivery-mode orders.
- Tags: `Kitchen`, `Orders`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `OrderId`) - Mongo ObjectId.
- Request body: None
- Responses:
  - `200`: Transitioned.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)
  - `409`: Resource state conflict. (ref: `Conflict`)

## /api/kitchen/orders/{id}/preparing

### POST /api/kitchen/orders/{id}/preparing
- Summary: Transition one-time order to preparing
- Description: Moves one-time order from `confirmed` to `preparing` when allowed.
- Tags: `Kitchen`, `Orders`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `OrderId`) - Mongo ObjectId.
- Request body: None
- Responses:
  - `200`: Transitioned.
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)
  - `409`: Resource state conflict. (ref: `Conflict`)

## /api/kitchen/orders/{id}/ready-for-pickup

### POST /api/kitchen/orders/{id}/ready-for-pickup
- Summary: Transition one-time order to ready_for_pickup
- Description: Valid only for pickup-mode orders.
- Tags: `Kitchen`, `Orders`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `OrderId`) - Mongo ObjectId.
- Request body: None
- Responses:
  - `200`: Transitioned.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)
  - `409`: Resource state conflict. (ref: `Conflict`)

## /api/kitchen/subscriptions/{id}/days/{date}/assign

### PUT /api/kitchen/subscriptions/{id}/days/{date}/assign
- Summary: Assign meals for subscription day
- Description: Assigns regular and premium selections with meals-per-day cap enforcement.
- Tags: `Kitchen`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `SubscriptionId`) - Mongo ObjectId.
  - `path.date` (string, required) (ref: `KsaDate`) - KSA date string in `YYYY-MM-DD` format.
- Request body required: yes
- Body fields: `selections`, `premiumSelections`
- Responses:
  - `200`: Assigned.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)
  - `500`: Internal error. (ref: `Internal`)

## /api/kitchen/subscriptions/{id}/days/{date}/fulfill-pickup

### POST /api/kitchen/subscriptions/{id}/days/{date}/fulfill-pickup
- Summary: Fulfill pickup subscription day
- Description: Finalizes pickup fulfillment using shared fulfillment service logic.
- Tags: `Kitchen`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `SubscriptionId`) - Mongo ObjectId.
  - `path.date` (string, required) (ref: `KsaDate`) - KSA date string in `YYYY-MM-DD` format.
- Request body: None
- Responses:
  - `200`: Fulfilled.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)
  - `409`: Resource state conflict. (ref: `Conflict`)
  - `500`: Internal error. (ref: `Internal`)

## /api/kitchen/subscriptions/{id}/days/{date}/in-preparation

### POST /api/kitchen/subscriptions/{id}/days/{date}/in-preparation
- Summary: Transition subscription day to in_preparation
- Description: Moves a locked subscription day into `in_preparation`.
- Tags: `Kitchen`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `SubscriptionId`) - Mongo ObjectId.
  - `path.date` (string, required) (ref: `KsaDate`) - KSA date string in `YYYY-MM-DD` format.
- Request body: None
- Responses:
  - `200`: Transitioned.
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)
  - `409`: Resource state conflict. (ref: `Conflict`)
  - `500`: Internal error. (ref: `Internal`)

## /api/kitchen/subscriptions/{id}/days/{date}/lock

### POST /api/kitchen/subscriptions/{id}/days/{date}/lock
- Summary: Transition subscription day to locked
- Description: Moves day to `locked` and captures locked snapshot data when needed.
- Tags: `Kitchen`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `SubscriptionId`) - Mongo ObjectId.
  - `path.date` (string, required) (ref: `KsaDate`) - KSA date string in `YYYY-MM-DD` format.
- Request body: None
- Responses:
  - `200`: Transitioned.
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)
  - `409`: Resource state conflict. (ref: `Conflict`)
  - `500`: Internal error. (ref: `Internal`)

## /api/kitchen/subscriptions/{id}/days/{date}/out-for-delivery

### POST /api/kitchen/subscriptions/{id}/days/{date}/out-for-delivery
- Summary: Transition subscription day to out_for_delivery
- Description: Creates delivery record when needed; valid only for delivery subscriptions.
- Tags: `Kitchen`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `SubscriptionId`) - Mongo ObjectId.
  - `path.date` (string, required) (ref: `KsaDate`) - KSA date string in `YYYY-MM-DD` format.
- Request body: None
- Responses:
  - `200`: Transitioned.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)
  - `409`: Resource state conflict. (ref: `Conflict`)
  - `500`: Internal error. (ref: `Internal`)

## /api/kitchen/subscriptions/{id}/days/{date}/ready-for-pickup

### POST /api/kitchen/subscriptions/{id}/days/{date}/ready-for-pickup
- Summary: Transition subscription day to ready_for_pickup
- Description: Valid only for pickup subscriptions.
- Tags: `Kitchen`
- Auth: Bearer dashboard token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `SubscriptionId`) - Mongo ObjectId.
  - `path.date` (string, required) (ref: `KsaDate`) - KSA date string in `YYYY-MM-DD` format.
- Request body: None
- Responses:
  - `200`: Transitioned.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)
  - `409`: Resource state conflict. (ref: `Conflict`)
  - `500`: Internal error. (ref: `Internal`)

## /api/orders

### GET /api/orders
- Summary: List current user's orders
- Description: Returns authenticated user's orders sorted by most recent first.
- Tags: `Orders`
- Auth: Bearer app token (`Authorization: Bearer <token>`)
- Parameters: None
- Request body: None
- Responses:
  - `200`: Order list.
  - `401`: Missing or invalid token. (ref: `Unauthorized`)

## /api/orders/{id}

### GET /api/orders/{id}
- Summary: Get order by id
- Description: Returns one order belonging to the authenticated user.
- Tags: `Orders`
- Auth: Bearer app token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `OrderId`) - Mongo ObjectId.
- Request body: None
- Responses:
  - `200`: Order found.
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `404`: Resource not found. (ref: `NotFound`)

## /api/orders/{id}/confirm

### POST /api/orders/{id}/confirm
- Summary: Confirm order payment (mock)
- Description: Marks order/payment as paid and confirms order when current state allows.
- Tags: `Orders`
- Auth: Bearer app token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `OrderId`) - Mongo ObjectId.
- Request body: None
- Responses:
  - `200`: Confirmed.
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `404`: Resource not found. (ref: `NotFound`)
  - `409`: Resource state conflict. (ref: `Conflict`)
  - `500`: Internal error. (ref: `Internal`)

## /api/orders/{id}/items/custom-salad

### POST /api/orders/{id}/items/custom-salad
- Summary: Add custom salad item to order
- Description: Allowed only while order is `created` and payment is `initiated`.
- Tags: `Orders`, `Meals / Menu`
- Auth: Bearer app token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `OrderId`) - Mongo ObjectId.
- Request body required: yes
- Required body fields: `ingredients`
- Body fields: `ingredients`
- Responses:
  - `200`: Order updated.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `404`: Resource not found. (ref: `NotFound`)
  - `409`: Resource state conflict. (ref: `Conflict`)
  - `500`: Internal error. (ref: `Internal`)

## /api/orders/checkout

### POST /api/orders/checkout
- Summary: Checkout one-time order
- Description: Creates order and initiated payment; delivery date may auto-shift if tomorrow cutoff already passed.
- Tags: `Orders`
- Auth: Bearer app token (`Authorization: Bearer <token>`)
- Parameters:
  - `header.Accept-Language` (string, optional) (ref: `AcceptLanguage`) - Preferred language. Runtime resolves to `ar` or `en`; unknown values fall back to `ar`.
- Request body required: yes
- Required body fields: `deliveryMode`
- Body fields: `meals`, `customSalads`, `deliveryMode`, `deliveryAddress`, `deliveryWindow`, `deliveryDate`
- Responses:
  - `200`: Order checkout created.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `404`: Resource not found. (ref: `NotFound`)
  - `429`: Rate limit or OTP cooldown exceeded. (ref: `TooManyRequests`)
  - `500`: Internal error. (ref: `Internal`)

## /api/plans

### GET /api/plans
- Summary: List active plans
- Description: Requires auth. Returns active plans only. Currency in response is always `SAR` (system currency). If non-SAR plan currency exists in database, checkout validation rejects it server-side. Each plan includes active grams options and active meals options only, sorted by: - plans: `sortOrder ASC`, then `createdAt DESC` - grams options: `sortOrder ASC`, then `grams ASC` - meals options: `sortOrder ASC`, then `mealsPerDay ASC`
- Tags: `Plans`
- Auth: Bearer app token (`Authorization: Bearer <token>`)
- Parameters:
  - `header.Accept-Language` (string, optional) (ref: `AcceptLanguage`) - Preferred language. Runtime resolves to `ar` or `en`; unknown values fall back to `ar`.
- Request body: None
- Responses:
  - `200`: Plan list.
  - `401`: Missing or invalid token. (ref: `Unauthorized`)

## /api/plans/{id}

### GET /api/plans/{id}
- Summary: Get plan by id
- Description: Requires auth. Returns one active plan only. Inactive/missing plans return `404 NOT_FOUND`.
- Tags: `Plans`
- Auth: Bearer app token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `PlanId`) - Plan Mongo ObjectId.
  - `header.Accept-Language` (string, optional) (ref: `AcceptLanguage`) - Preferred language. Runtime resolves to `ar` or `en`; unknown values fall back to `ar`.
- Request body: None
- Responses:
  - `200`: Plan found.
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `404`: Resource not found. (ref: `NotFound`)

## /api/premium-meals

### GET /api/premium-meals
- Summary: List active premium meals
- Description: Returns active premium meals only, sorted by `sortOrder ASC`, then `createdAt DESC`. Localized fields are resolved with `Accept-Language`.
- Tags: `Menu`
- Auth: None
- Parameters:
  - `header.Accept-Language` (string, optional) (ref: `AcceptLanguage`) - Preferred language. Runtime resolves to `ar` or `en`; unknown values fall back to `ar`.
- Request body: None
- Responses:
  - `200`: Premium meals list.

## /api/salad-ingredients

### GET /api/salad-ingredients
- Summary: List active salad ingredients
- Description: Returns localized ingredient name by `Accept-Language`.
- Tags: `Meals / Menu`
- Auth: None
- Parameters:
  - `header.Accept-Language` (string, optional) (ref: `AcceptLanguage`) - Preferred language. Runtime resolves to `ar` or `en`; unknown values fall back to `ar`.
- Request body: None
- Responses:
  - `200`: Active ingredients.

## /api/settings

### GET /api/settings
- Summary: Get public runtime settings
- Description: Returns settings map with defaults when keys are missing.
- Tags: `System`
- Auth: None
- Parameters: None
- Request body: None
- Responses:
  - `200`: Settings map.

## /api/subscriptions/{id}

### GET /api/subscriptions/{id}
- Summary: Get subscription by id
- Description: Returns subscription document by id.
- Tags: `Subscriptions`
- Auth: Bearer app token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `SubscriptionId`) - Mongo ObjectId.
- Request body: None
- Responses:
  - `200`: Subscription found.
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)

## /api/subscriptions/{id}/activate

### POST /api/subscriptions/{id}/activate
- Summary: Activate subscription (mock endpoint)
- Description: Development-only helper that transitions subscription to `active` and creates day records. In production, this endpoint returns `403 FORBIDDEN`.
- Tags: `Subscriptions`
- Auth: Bearer app token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `SubscriptionId`) - Mongo ObjectId.
- Request body: None
- Responses:
  - `200`: Activated or already active.
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)

## /api/subscriptions/{id}/addon-credits/topup

### POST /api/subscriptions/{id}/addon-credits/topup
- Summary: Purchase itemized addon credits top-up
- Description: Creates Moyasar invoice/payment for itemized addon credits. Wallet credits are applied only after webhook confirms payment status `paid`.
- Tags: `Wallet`
- Auth: Bearer app token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `SubscriptionId`) - Mongo ObjectId.
- Request body required: yes
- Body schema: `#/components/schemas/AddonTopupRequest`
- Responses:
  - `200`: Invoice created.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)
  - `422`: Unprocessable entity / business rule violation. (ref: `Unprocessable`)
  - `500`: Internal error. (ref: `Internal`)

## /api/subscriptions/{id}/addon-selections

### POST /api/subscriptions/{id}/addon-selections
- Summary: Consume addon wallet credits for a day
- Description: Consumes addon credits (`qty >= 1`) using FIFO. Requires active subscription and open day.
- Tags: `Wallet`
- Auth: Bearer app token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `SubscriptionId`) - Mongo ObjectId.
- Request body required: yes
- Body schema: `#/components/schemas/ConsumeAddonSelectionRequest`
- Responses:
  - `200`: Addon credits consumed.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)
  - `409`: Locked day, duplicate selection, or insufficient addon credits.
  - `422`: Unprocessable entity / business rule violation. (ref: `Unprocessable`)
  - `500`: Internal error. (ref: `Internal`)

### DELETE /api/subscriptions/{id}/addon-selections
- Summary: Refund addon selections for a day/addon pair
- Description: Refunds all addon selection rows matching `(dayId|date + addonId)`. Refund is allowed only when subscription is active and day status is `open`. Missing bucket/overflow conflicts return `409 DATA_INTEGRITY_ERROR`.
- Tags: `Wallet`
- Auth: Bearer app token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `SubscriptionId`) - Mongo ObjectId.
- Request body required: yes
- Body schema: `#/components/schemas/RefundAddonSelectionRequest`
- Responses:
  - `200`: Refunded.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)
  - `409`: Locked day or wallet integrity conflict.
  - `422`: Unprocessable entity / business rule violation. (ref: `Unprocessable`)
  - `500`: Internal error. (ref: `Internal`)

## /api/subscriptions/{id}/addons/one-time

### POST /api/subscriptions/{id}/addons/one-time
- Summary: Purchase one-time add-on for a date
- Description: Creates Moyasar invoice/payment; add-on is applied by webhook when paid.
- Tags: `Subscriptions`
- Auth: Bearer app token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `SubscriptionId`) - Mongo ObjectId.
  - `header.Accept-Language` (string, optional) (ref: `AcceptLanguage`) - Preferred language. Runtime resolves to `ar` or `en`; unknown values fall back to `ar`.
- Request body required: yes
- Required body fields: `addonId`, `date`
- Body fields: `addonId`, `date`, `successUrl`, `backUrl`
- Responses:
  - `200`: Invoice created.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)
  - `409`: Resource state conflict. (ref: `Conflict`)
  - `422`: Unprocessable entity / business rule violation. (ref: `Unprocessable`)
  - `500`: Internal error. (ref: `Internal`)

## /api/subscriptions/{id}/days

### GET /api/subscriptions/{id}/days
- Summary: List all subscription days
- Description: Returns day list sorted by date with client-facing mapped statuses.
- Tags: `Subscriptions`
- Auth: Bearer app token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `SubscriptionId`) - Mongo ObjectId.
- Request body: None
- Responses:
  - `200`: Day list.
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)

## /api/subscriptions/{id}/days/{date}

### GET /api/subscriptions/{id}/days/{date}
- Summary: Get subscription day by date
- Description: Returns a specific day record for the provided KSA date.
- Tags: `Subscriptions`
- Auth: Bearer app token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `SubscriptionId`) - Mongo ObjectId.
  - `path.date` (string, required) (ref: `KsaDate`) - KSA date string in `YYYY-MM-DD` format.
- Request body: None
- Responses:
  - `200`: Day found.
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)

## /api/subscriptions/{id}/days/{date}/custom-salad

### POST /api/subscriptions/{id}/days/{date}/custom-salad
- Summary: Initiate custom salad payment for subscription day
- Description: Builds priced custom salad snapshot and creates a payment invoice. The salad is applied only after webhook confirms payment.
- Tags: `Subscriptions`, `Meals / Menu`
- Auth: Bearer app token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `SubscriptionId`) - Mongo ObjectId.
  - `path.date` (string, required) (ref: `KsaDate`) - KSA date string in `YYYY-MM-DD` format.
- Request body required: yes
- Required body fields: `ingredients`
- Body fields: `ingredients`, `successUrl`, `backUrl`
- Responses:
  - `200`: Payment invoice created.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)
  - `409`: Resource state conflict. (ref: `Conflict`)
  - `422`: Unprocessable entity / business rule violation. (ref: `Unprocessable`)
  - `500`: Internal error. (ref: `Internal`)

## /api/subscriptions/{id}/days/{date}/delivery

### PUT /api/subscriptions/{id}/days/{date}/delivery
- Summary: Override delivery details for one date
- Description: Updates `deliveryAddressOverride`/`deliveryWindowOverride` for a specific open day.
- Tags: `Subscriptions`
- Auth: Bearer app token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `SubscriptionId`) - Mongo ObjectId.
  - `path.date` (string, required) (ref: `KsaDate`) - KSA date string in `YYYY-MM-DD` format.
- Request body required: yes
- Body fields: `deliveryAddress`, `deliveryWindow`
- Responses:
  - `200`: Day override updated.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)
  - `409`: Resource state conflict. (ref: `Conflict`)
  - `422`: Unprocessable entity / business rule violation. (ref: `Unprocessable`)
  - `500`: Internal error. (ref: `Internal`)

## /api/subscriptions/{id}/days/{date}/pickup/prepare

### POST /api/subscriptions/{id}/days/{date}/pickup/prepare
- Summary: Prepare pickup for a date
- Description: For pickup subscriptions only; locks day and deducts meal credits atomically.
- Tags: `Subscriptions`
- Auth: Bearer app token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `SubscriptionId`) - Mongo ObjectId.
  - `path.date` (string, required) (ref: `KsaDate`) - KSA date string in `YYYY-MM-DD` format.
- Request body: None
- Responses:
  - `200`: Prepared (idempotent when already prepared).
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)
  - `409`: Resource state conflict. (ref: `Conflict`)
  - `422`: Unprocessable entity / business rule violation. (ref: `Unprocessable`)
  - `500`: Internal error. (ref: `Internal`)

## /api/subscriptions/{id}/days/{date}/selection

### PUT /api/subscriptions/{id}/days/{date}/selection
- Summary: Update day meal selections
- Description: Updates selections for a future open day and adjusts premium credits atomically.
- Tags: `Subscriptions`
- Auth: Bearer app token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `SubscriptionId`) - Mongo ObjectId.
  - `path.date` (string, required) (ref: `KsaDate`) - KSA date string in `YYYY-MM-DD` format.
- Request body required: yes
- Body fields: `selections`, `premiumSelections`, `addonsOneTime`
- Responses:
  - `200`: Updated or idempotent no-op.
  - `400`: Validation/cutoff/daily-cap/premium errors.
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)
  - `409`: Resource state conflict. (ref: `Conflict`)
  - `422`: Unprocessable entity / business rule violation. (ref: `Unprocessable`)
  - `500`: Internal error. (ref: `Internal`)

## /api/subscriptions/{id}/days/{date}/skip

### POST /api/subscriptions/{id}/days/{date}/skip
- Summary: Skip one subscription day
- Description: Applies skip rules and credit deduction for one day.
- Tags: `Subscriptions`
- Auth: Bearer app token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `SubscriptionId`) - Mongo ObjectId.
  - `path.date` (string, required) (ref: `KsaDate`) - KSA date string in `YYYY-MM-DD` format.
- Request body: None
- Responses:
  - `200`: Skipped or already skipped.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)
  - `409`: Resource state conflict. (ref: `Conflict`)
  - `422`: Unprocessable entity / business rule violation. (ref: `Unprocessable`)
  - `500`: Internal error. (ref: `Internal`)

## /api/subscriptions/{id}/delivery

### PUT /api/subscriptions/{id}/delivery
- Summary: Update subscription-level delivery details
- Description: Updates base delivery address/window for delivery-mode subscriptions.
- Tags: `Subscriptions`
- Auth: Bearer app token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `SubscriptionId`) - Mongo ObjectId.
- Request body required: yes
- Body fields: `deliveryAddress`, `deliveryWindow`
- Responses:
  - `200`: Subscription updated.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `404`: Resource not found. (ref: `NotFound`)
  - `422`: Unprocessable entity / business rule violation. (ref: `Unprocessable`)

## /api/subscriptions/{id}/premium-credits/topup

### POST /api/subscriptions/{id}/premium-credits/topup
- Summary: Purchase itemized premium credits top-up
- Description: Creates Moyasar invoice/payment for itemized premium meal credits. Wallet credits are applied only after webhook confirms payment status `paid`.
- Tags: `Wallet`
- Auth: Bearer app token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `SubscriptionId`) - Mongo ObjectId.
- Request body required: yes
- Body schema: `#/components/schemas/PremiumTopupRequest`
- Responses:
  - `200`: Invoice created.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)
  - `422`: Unprocessable entity / business rule violation. (ref: `Unprocessable`)
  - `500`: Internal error. (ref: `Internal`)

## /api/subscriptions/{id}/premium-selections

### POST /api/subscriptions/{id}/premium-selections
- Summary: Consume one premium wallet credit for a day slot
- Description: Upgrades one base slot to a premium meal. Rules: - subscription must be active and owned by caller - day must be `open` - `baseSlotKey` can be upgraded only once per day - wallet deduction is FIFO by `purchasedAt`
- Tags: `Wallet`
- Auth: Bearer app token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `SubscriptionId`) - Mongo ObjectId.
- Request body required: yes
- Body schema: `#/components/schemas/ConsumePremiumSelectionRequest`
- Example body:
```json
{
  "date": "2026-03-12",
  "baseSlotKey": "meal_slot_1",
  "premiumMealId": "65f2000a1f1f1f1f1f1f2001"
}
```
- Responses:
  - `200`: Premium credit consumed.
  - `400`: Input validation failed. (ref: `ValidationError`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)
  - `409`: Locked day, duplicate slot, or insufficient premium credits.
  - `422`: Unprocessable entity / business rule violation. (ref: `Unprocessable`)
  - `500`: Internal error. (ref: `Internal`)

### DELETE /api/subscriptions/{id}/premium-selections
- Summary: Refund one premium selection
- Description: Refunds one premium selection by `(dayId|date + baseSlotKey)`. Refund is allowed only when subscription is active and day status is `open`. If original wallet bucket is missing or exceeds purchased quantity, returns `409 DATA_INTEGRITY_ERROR`.
- Tags: `Wallet`
- Auth: Bearer app token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `SubscriptionId`) - Mongo ObjectId.
- Request body required: yes
- Body schema: `#/components/schemas/RefundPremiumSelectionRequest`
- Responses:
  - `200`: Refunded.
  - `400`: Input validation failed. (ref: `ValidationError`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)
  - `409`: Locked day or wallet integrity conflict.
  - `422`: Unprocessable entity / business rule violation. (ref: `Unprocessable`)
  - `500`: Internal error. (ref: `Internal`)

## /api/subscriptions/{id}/premium/topup

### POST /api/subscriptions/{id}/premium/topup
- Summary: Purchase premium top-up (legacy count or itemized, deprecated)
- Description: Deprecated compatibility endpoint. Use `/api/subscriptions/{id}/premium-credits/topup` for all new integrations. Removal is planned no earlier than `2026-06-30`. If body contains `items[]`, it behaves like `/api/subscriptions/{id}/premium-credits/topup`; otherwise it uses legacy `count`.
- Tags: `Subscriptions`
- Auth: Bearer app token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `SubscriptionId`) - Mongo ObjectId.
- Request body required: yes
- Body fields: `count`, `items`, `successUrl`, `backUrl`
- Responses:
  - `200`: Invoice created.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)
  - `422`: Unprocessable entity / business rule violation. (ref: `Unprocessable`)
  - `500`: Internal error. (ref: `Internal`)

## /api/subscriptions/{id}/skip-range

### POST /api/subscriptions/{id}/skip-range
- Summary: Skip a date range
- Description: Attempts to skip `days` consecutive dates from `startDate`, returning per-date summary. `compensatedDatesAdded` is currently returned as an empty list by runtime rules.
- Tags: `Subscriptions`
- Auth: Bearer app token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `SubscriptionId`) - Mongo ObjectId.
- Request body required: yes
- Required body fields: `startDate`, `days`
- Body fields: `startDate`, `days`
- Responses:
  - `200`: Skip summary.
  - `400`: Bad request. (ref: `BadRequest`)
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)
  - `422`: Unprocessable entity / business rule violation. (ref: `Unprocessable`)
  - `500`: Internal error. (ref: `Internal`)

## /api/subscriptions/{id}/today

### GET /api/subscriptions/{id}/today
- Summary: Get today's subscription day
- Description: Returns today's day record for the subscription.
- Tags: `Subscriptions`
- Auth: Bearer app token (`Authorization: Bearer <token>`)
- Parameters:
  - `path.id` (string, required) (ref: `SubscriptionId`) - Mongo ObjectId.
- Request body: None
- Responses:
  - `200`: Day found.
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `403`: Authenticated but insufficient role/permissions. (ref: `Forbidden`)
  - `404`: Resource not found. (ref: `NotFound`)

## /api/subscriptions/checkout

### POST /api/subscriptions/checkout
- Summary: Checkout subscription
- Description: Initializes a checkout draft and payment invoice. Does **not** create a subscription yet. Subscription and wallet credits are created **ONLY** by webhook when payment status becomes `paid`. Safety rules: - idempotency key is required (header `Idempotency-Key` or `X-Idempotency-Key`, or `body.idempotencyKey`) - totals are recomputed server-side from current plan/menu/settings - system currency is SAR only
- Tags: `Subscriptions`
- Auth: Bearer app token (`Authorization: Bearer <token>`)
- Parameters:
  - `header.Accept-Language` (string, optional) (ref: `AcceptLanguage`) - Preferred language. Runtime resolves to `ar` or `en`; unknown values fall back to `ar`.
  - `header.Idempotency-Key` (string, optional) - Required unless provided via `X-Idempotency-Key` header or `body.idempotencyKey`.
  - `header.X-Idempotency-Key` (string, optional) - Alias for `Idempotency-Key`.
- Request body required: yes
- Body schema: `#/components/schemas/SubscriptionCheckoutRequest`
- Responses:
  - `200`: Existing draft/payment reused for the same idempotency key or pending identical hash.
  - `201`: Draft + initiated payment created.
  - `400`: Validation error (including missing idempotency key).
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `404`: Resource not found. (ref: `NotFound`)
  - `409`: Idempotency conflict or checkout still initializing.
  - `429`: Rate limit or OTP cooldown exceeded. (ref: `TooManyRequests`)

## /api/subscriptions/quote

### POST /api/subscriptions/quote
- Summary: Quote subscription checkout totals
- Description: Computes pricing server-side only. Client-provided totals or delivery fee are never trusted. Pricing model: - `basePlanPriceHalala` from selected active plan option (`planId + grams + mealsPerDay`) - `premiumTotalHalala` from active premium meals - `addonsTotalHalala` from active addons - `deliveryFeeHalala` from server settings (`subscription_delivery_fee_halala`) - optional `vatHalala` from `vat_percentage` setting
- Tags: `Subscriptions`
- Auth: Bearer app token (`Authorization: Bearer <token>`)
- Parameters: None
- Request body required: yes
- Body schema: `#/components/schemas/SubscriptionQuoteRequest`
- Example body:
```json
{
  "planId": "65f1000a1f1f1f1f1f1f1001",
  "grams": 100,
  "mealsPerDay": 2,
  "startDate": "2026-03-10",
  "delivery": {
    "type": "delivery",
    "address": {
      "city": "Riyadh",
      "district": "Al Olaya",
      "line1": "Street 10"
    },
    "slot": {
      "type": "delivery",
      "window": "12:00-15:00",
      "slotId": "slot_1"
    }
  },
  "premiumItems": [
    {
      "premiumMealId": "65f2000a1f1f1f1f1f1f2001",
      "qty": 2
    }
  ],
  "addons": [
    {
      "addonId": "65f2000a1f1f1f1f1f1f3001",
      "qty": 1
    }
  ]
}
```
- Responses:
  - `200`: Quote breakdown.
  - `400`: Validation/selection/configuration errors.
  - `401`: Missing or invalid token. (ref: `Unauthorized`)
  - `404`: Resource not found. (ref: `NotFound`)

## /api/webhooks/moyasar

### POST /api/webhooks/moyasar
- Summary: Moyasar payment webhook
- Description: Public webhook endpoint. Security behavior in code: - `MOYASAR_WEBHOOK_SECRET` is required and request body `secret_token` must match, otherwise `401 UNAUTHORIZED`. - Webhook payload identifiers must match stored payment identifiers, amount, and currency (`409 MISMATCH` on any mismatch). State machine behavior: - Always persists latest recognized payment status (`initiated|paid|failed|canceled|expired|refunded`). - Side effects are applied only when status is `paid` and `Payment.applied === false`. - Non-paid terminal statuses (`failed|canceled|expired`) update checkout draft status when applicable. Idempotency behavior: - Duplicate/repeated webhooks are safe. - `Payment.applied` is claimed atomically; once applied, webhook returns `{ ok: true }` without re-applying credits/subscription creation.
- Tags: `Webhooks`
- Auth: None
- Parameters: None
- Request body required: yes
- Body fields: `type`, `event`, `secret_token`, `data`, `payment`
- Example body:
```json
{
  "type": "payment_paid",
  "secret_token": "your-shared-secret",
  "data": {
    "id": "pay_abc123",
    "invoice_id": "inv_abc123",
    "status": "paid",
    "amount": 5000,
    "currency": "SAR"
  }
}
```
- Responses:
  - `200`: Webhook accepted/processed (including duplicate or ignored events).
  - `400`: Invalid payload (missing payment identifiers).
  - `401`: Invalid or missing webhook secret token.
  - `404`: Referenced payment not found.
  - `409`: Payload/payment mismatch (id/invoice/amount/currency).
  - `500`: Internal error. (ref: `Internal`)

## /health

### GET /health
- Summary: Health check with DB status
- Description: Returns API status and Mongo connectivity state.
- Tags: `System`
- Auth: None
- Parameters: None
- Request body: None
- Responses:
  - `200`: API and DB are healthy.
  - `503`: Database unavailable.
