# Active add-on plan mobile catalog cycle

The mobile add-on choices endpoint now overlays products from every active, non-archived dashboard add-on plan onto the customer catalog.

Cycle:

1. Dashboard creates or updates an add-on plan with `menuProductIds`.
2. `isActive=true` and `isArchived!=true` make the plan customer-visible.
3. Linked products must also be active, visible, available, published, not archived/deleted, and available for the one-time channel.
4. The backend resolves each product's actual `MenuCategory` and creates the dynamic response category.
5. Existing subscription entitlement metadata is preserved and controls allowance eligibility.
6. Deactivating or archiving the plan removes its dynamic category and rows from the mobile response.

No Flutter request or response contract change is required.