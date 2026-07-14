# Add-on Choices Availability Fix

The mobile add-on choices response now respects dashboard plan and catalog availability.

## Behavior

- Inactive, archived, removed, or deleted add-on plans do not keep dynamic categories visible.
- Choices and entitlement metadata tied to inactive or archived plans are removed.
- Legacy generic categories remain backward compatible while inactive plan metadata is stripped.
- Inactive, hidden, unavailable, archived, and deleted menu/catalog documents are excluded from customer-facing add-on choices.
- No Flutter or mobile request contract change is required.

## Regression coverage

`tests/addonChoicesAvailabilityFilter.test.js` covers active, inactive, archived, deleted, legacy generic, and dynamic category behavior.
