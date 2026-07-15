# Production Readiness Report

Updated: 2026-07-16

## Summary

Branch: `main`

Reviewed baseline: `519efefd233337aae83cb62d0edf68c78307a825`

Release-gate hardening commit: `93035a57d8deedcb6d884aac766c2cf91331dc32`

Current status: **READY FOR PRODUCTION QA**

The backend contains the production cleanup, validation-blocker fixes, dashboard user search, Kitchen read-only catalog permissions, Arabic manual-deduction responses, deterministic add-on parity testing, and the current premium source-relation contract.

This report is not a controlled production release sign-off. Staging/provider checks and production-data readiness still need to be completed.

## Confirmed Code State

### Authentication

The backend supports:

- Admin-created users with generated temporary passwords.
- Forced password change using a restricted password-change token.
- `authVersion` access/refresh revocation.
- Admin password reset that invalidates previous sessions.
- OTP reset clearing temporary-password state.

### Add-ons and balances

The backend contains fixes for:

- Legacy category-only entitlement coverage for same-category products.
- Exact modern product snapshot enforcement.
- Category isolation.
- Strict wallet bucket identity persistence.
- Idempotent credit release.
- Covered-versus-paid behavior.
- Dashboard product/category validation.

### Dashboard users

`GET /api/dashboard/users` supports filtering before pagination by:

- Name.
- Phone and normalized phone forms.
- Email.
- Active/inactive status.
- Temporary-password authentication state.

Search input is escaped before use in regular expressions.

### Kitchen permissions

Kitchen users have read-only access to the data needed by the add-ons workspace, including:

- `GET /api/dashboard/plans`
- `GET /api/dashboard/plans/:id`
- Add-on plans, items, and prices read endpoints.

Plan and add-on mutations remain admin-only.

### Manual deduction localization

Manual-deduction validation preserves stable error codes and returns Arabic user-facing messages when `Accept-Language: ar` is supplied, including insufficient total, regular, and premium meal balances.

### One-time menu

Configured `basic_meal` protein options are exposed to the one-time menu instead of being removed by subscription-only serialization rules.

## Canonical Premium Relink Contract

Endpoint:

```http
PATCH /api/dashboard/premium-upgrades/:id
```

Product source or an option with one eligible relation:

```json
{
  "expectedRevision": 4,
  "kind": "option",
  "sourceId": "<source id>"
}
```

For an option that appears in multiple active product/group relations, the selected `/sources` row must provide exact relation context:

```json
{
  "expectedRevision": 4,
  "kind": "option",
  "sourceId": "<option id>",
  "relationId": "<relation id returned by /sources>"
}
```

Compatibility behavior may accept both `sourceProductId` and `sourceGroupId` when they are supplied consistently.

Rules:

- The backend preserves `premiumKey`.
- The client must not control `premiumKey` or `selectionType`.
- Ambiguous option relinks without relation context return `PREMIUM_SOURCE_RELATION_AMBIGUOUS`.
- Invalid or conflicting relation context returns `PREMIUM_SOURCE_RELATION_INVALID`.
- Incompatible business identity returns `PREMIUM_RELINK_KEY_MISMATCH`.
- Revision conflict protection remains required.

## Canonical Release Gate

Run:

```bash
npm ci
npm run test:release-gates
```

`test:release-gates` now includes:

- Backend structural validation.
- Default regression tests.
- Security tests.
- Checkout and concurrency.
- One-time orders.
- Subscription policies and concurrency.
- Add-on allocation, lifecycle, parity, and owned-meal entitlement.
- Mobile contracts.
- Payment initialization logging.
- Builder catalog contract.
- Dashboard users search.
- Kitchen read-only permissions.
- Manual deduction and pickup flow.
- One-time menu contract.
- Premium meal backend lifecycle.

The add-on Dashboard/Mobile parity test runs once and fails deterministically; it no longer retries itself using `command || command`.

## Previous Automated Evidence

The validation pass completed successfully before the latest release-gate composition change:

- `npm test`: 66 passed, 0 failed.
- `npm run validate:backend`: passed.
- Security suite: passed.
- Checkout: 34 passed, 0 failed.
- Checkout concurrency: 3 passed, 0 failed.
- Subscription suites: passed.
- Add-on allocation/lifecycle/parity: passed.
- Mobile contracts: passed.
- Builder catalog v2 contract: passed.
- Premium lifecycle integration: 49 passed, 0 failed.

The expanded `npm run test:release-gates` must be executed on the current HEAD after pulling because this GitHub API editing environment cannot execute the repository test suite.

## Remaining Production Work

### Production data

Verify:

```http
GET /api/dashboard/premium-upgrades/readiness
```

Required result:

```text
isReady = true
missingSources = 0
invalidRelations = 0
invalidConfigs = 0
duplicateKeys = 0
```

Any stale premium rows must be repaired through a reviewed, dry-run-capable, idempotent operation.

### Package lifecycle

Run staging E2E for:

```text
create → list → details → update → quote/checkout compatibility → disable/archive
```

A Dashboard-created plan must remain canonical, visible, editable, and consumable by checkout/mobile APIs.

### Delivery and operations

Run the full staging lifecycle for pickup and delivery, including discovery of valid delivery slots/windows, kitchen preparation, courier transitions, fulfillment, cancellation, and backend-owned `allowedActions`.

### Providers and infrastructure

Verify:

- Moyasar payment initialization, callback, and webhook signatures.
- Production CORS origins and secrets.
- Database backups and indexes.
- Graceful shutdown and observability.
- Deployment health checks using `/live`, `/ready`, and `/health`.

### Dependency advisory

`npm audit --omit=dev` previously reported 8 moderate transitive advisories through `firebase-admin` and Google Cloud packages. The proposed full npm fix requires a breaking `firebase-admin` major upgrade and must not be applied with `npm audit fix --force` without a dedicated migration and Firebase regression pass.

## Final Readiness Status

**READY FOR PRODUCTION QA**

The backend code is suitable for final staging validation. Controlled production release must wait for the expanded release gate on current HEAD, production premium readiness, real package/delivery E2E, provider verification, and formal disposition of the moderate dependency advisories.
