# BasicDiet145 Dashboard API Docs

Files in this package:

- `openapi.dashboard.json`: OpenAPI 3.0.3 spec for Dashboard/Admin APIs.
- `DASHBOARD_API_GUIDE.md`: Developer guide with auth, roles, business flows, audit, soft delete, and safety notes.
- `postman.dashboard_collection.json`: Compact Postman v2.1 collection generated from the OpenAPI contract.
- `postman.dashboard_full_collection.json`: Full QA-ready Postman v2.1 collection with collection-level bearer auth, richer request descriptions, realistic bodies, variable-saving tests, and Common Workflows.
- `endpoint-matrix.md`: Compact endpoint table for frontend, QA, and onboarding.

## Swagger UI

Import `docs/dashboard-api/openapi.dashboard.json` into Swagger UI, Swagger Editor, Stoplight, or Postman.

Servers are preconfigured:

- Local: `http://localhost:3000/api`
- Production Render: `https://basicdiet145.onrender.com/api`

## Postman

Import one of these collections into Postman:

- `docs/dashboard-api/postman.dashboard_collection.json` for a compact endpoint collection.
- `docs/dashboard-api/postman.dashboard_full_collection.json` for the recommended QA/onboarding collection.

Set:

- `{{baseUrl}}`: defaults to `https://basicdiet145.onrender.com/api`
- `{{localBaseUrl}}`: `http://localhost:3000/api` when testing locally
- `{{dashboardToken}}`: token from `POST /dashboard/auth/login`

The full collection stores the bearer token at collection level. The `Auth / Login` request has a Tests script that reads `token`, `data.token`, or `data.accessToken` and saves it into `{{dashboardToken}}` automatically.

## Recommended QA Workflow

1. Import `docs/dashboard-api/postman.dashboard_full_collection.json`.
2. Run `Auth / Login`.
3. Confirm `{{dashboardToken}}` was saved automatically.
4. Set the entity variables you need first, usually `{{appUserId}}`, `{{planId}}`, `{{addonPlanId}}`, and later `{{subscriptionId}}`.
5. Use `Common Workflows` for ordered smoke paths:
   - Login + Basic Setup
   - Create Subscription From Dashboard
   - Manage Addons
   - Manage Delivery Zones
   - Subscription Admin Actions

## Authentication

Dashboard auth is separate from mobile app auth. Use:

`Authorization: Bearer {{dashboardToken}}`

Roles: `superadmin`, `admin`, `kitchen`, `courier`.
