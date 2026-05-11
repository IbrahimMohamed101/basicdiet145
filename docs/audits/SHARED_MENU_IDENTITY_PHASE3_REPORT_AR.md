# Shared Menu Identity Suggestions Report

## Files Changed
- `scripts/suggest-menu-identity-mappings.js`: CLI tool for automated mapping suggestions.
- `tests/menuIdentitySuggestions.test.js`: Integration tests for normalization and suggestion logic.
- `package.json`: Added `test:menu-identity-suggestions` and `suggest:menu-identity` scripts.
- `scripts/validate-backend.js`: Integrated suggestion logic validation.

## How Suggestions Work
The script scans all primary menu sources across both channels:
- **One-time**: `MenuProduct`, `MenuOption`, `MenuCategory`.
- **Subscription**: `BuilderProtein`, `BuilderCarb`, `SaladIngredient`, `Addon`, `Sandwich`.

For each record, it generates a **Canonical Token** based on:
1. **Arabic Normalization**: Harmonizing `أ/إ/آ` to `ا`, `ة` to `ه`, and `ى` to `ي`.
2. **Alias Dictionary**: Bridging common business synonyms like `جمبري` (shrimp) and `روبيان` (prawns).
3. **Space Normalization**: Removing redundant whitespace and case-insensitive matching.

Matches across channels are categorized by **Confidence**:
- `exact`: Identity and source names match perfectly after normalization.
- `alias`: Different names bridged by the synonym dictionary.

## Safety Guards
- **Dry-Run by Default**: The script only calculates and reports suggestions without writing.
- **Explicit Opt-In**: Requires `MENU_IDENTITY_MAPPING_WRITE=true` to persist identities/links.
- **Production Safeguard**: Will refuse to run in write mode against a production URI unless a separate override is provided.
- **Idempotency**: Will not create duplicate links for the same source record if an active one already exists.

## Tests
Verified via `tests/menuIdentitySuggestions.test.js`:
- Arabic spelling variations (rice/rice).
- Synonym matching (shrimp/prawns).
- Persistence safety (dry-run vs. write mode).
- Collision handling for multiple records matching the same group.

## What Did Not Change
- **API Runtime**: The suggestions are stored in the mapping layer which is not yet linked to order/subscription processing.
- **Existing Data**: No existing menu records are modified.
- **Mobile Contracts**: No public endpoints use this logic.

## How To Review Suggested Mappings
1. Run `npm run suggest:menu-identity`.
2. Review the generated report at `output/menu-identity-suggestions.json`.
3. Check for any "warnings" or ambiguous groupings before deciding to apply them in a staging environment.
