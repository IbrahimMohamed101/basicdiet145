# Shared Menu Identity Phase 1 Report

## Files Changed
- `package.json`: Added `test:menu-identity` and `validate:menu-identity` scripts.
- `src/models/SharedMenuIdentity.js`: New model for canonical menu identities.
- `src/models/MenuIdentityLink.js`: New model for linking identities to source records across channels.
- `src/services/menuIdentityMappingService.js`: New service for normalization, internal helpers, and read-only validation.
- `scripts/validate-menu-identity-links.js`: New read-only audit script for mapping integrity.
- `scripts/validate-backend.js`: Integrated mapping safety tests.
- `src/controllers/adminController.js`: Fixed a duplicate declaration of `buildPaginationMeta`.

## Models Added

### SharedMenuIdentity
Stores the "Source of Truth" for a menu item across systems.
- **Fields**: key, type, name (ar/en), aliases, imageUrl, canonicalFamilyKey, tags, isActive.
- **Validation**: Enforces unique key, requires at least one name (ar or en).
- **Normalization**: Keys are snake_case; aliases/names are normalized for Arabic character variations.

### MenuIdentityLink
Links a SharedMenuIdentity to a specific record in one of the existing menu models.
- **Fields**: identityId, channel (one_time/subscription), sourceModel, sourceId, confidence, status, isActive.
- **Constraints**: Enforces a unique active link per source record (prevents one product from mapping to multiple identities).

## Indexes Added
- `SharedMenuIdentity`: Unique index on `key`.
- `MenuIdentityLink`: Partial unique index on `{ channel, sourceModel, sourceId }` where `isActive: true`.

## Validation Logic
The `validateIdentityLinks` service function provides:
- Existence checks for both identities and source records.
- Soft collision detection for aliases (warnings, not hard failures).
- Detection of double-mapping (if bypasses occurred).
- Relationship integrity (links to inactive identities/sources).

## API Compatibility Guarantee
- **Zero Impact on Mobile**: No changes were made to existing controllers, routes, or response shapes.
- **Zero Impact on Runtime**: The mapping layer is currently independent and not imported by any service used in order or subscription flows.
- **Read-Only First**: The mapping layer is strictly for audit and internal dashboard use in Phase 1.

## Tests Added
`tests/menuIdentityMapping.test.js` covers:
- Key uniqueness and name requirements.
- Link unique constraints across channels.
- Arabic character normalization (Alif, Teh Marbuta, Yeh variations).
- Read-only validation reporting for errors and warnings.

## Test Results
- `npm run test:menu-identity`: **PASSED** (6 tests)
- `npm run validate:backend`: **PASSED** (All core and E2E tests)

## What Did Not Change
- Existing model schemas for `MenuProduct`, `MenuOption`, etc.
- Subscription planner logic or pricing rules.
- One-time order flow or webhook logic.
- Flutter mobile response contracts.

## Dashboard-Only Future Changes
Future phases will introduce dashboard-only visibility into these mappings to ensure data consistency before any "Merge" or "Canonical" behavior is enabled in the API.

## Next Safe Phase
Phase 2 recommendation: Add a dashboard UI to visualize suggested mappings and manual link confirmation interface without changing any business logic.
