# Backend Decisions & Open Questions

## Confirmed Direction
- **Backend stack:** Node.js.
- **Database:** MongoDB (app data).
- **Auth & OTP:** Firebase Authentication.
- **Notifications:** Firebase Cloud Messaging (FCM).
- **Timezone:** Saudi Arabia only (single fixed timezone).
- **Selection window:** user can preselect up to **one week** ahead.
- **Default selection:** if the user does not choose, the restaurant/kitchen selects.
- **Out-of-stock handling:** if a user-selected dish becomes unavailable, notify both user and kitchen; kitchen can assign an alternative or allow the user to pick another.

## Snapshots (Simplest Approach)
- Store **JSON snapshots** in a dedicated collection (e.g., `daySnapshots`) with:
  - `subscriptionDayId`, `status` (`locked` or `in_preparation`), `payload`, `createdAt`.
- **Locked snapshot** payload includes: allowed meals, user choices, `meals_per_day`, delivery address.
- **Binding snapshot** (`in_preparation`) payload includes: final meals, final count, final price.

## Payment Gateway (Saudi Arabia – Simple Options)
Potential providers to evaluate:
- **Moyasar** (simple integration, local focus).
- **HyperPay** (widely used in KSA).
- **PayTabs** (regional, SDKs available).
- **Tap Payments** (MENA-friendly).

## Open Questions
1. Preferred payment provider (if any) from the options above?
2. Any constraints around Apple Pay / Mada / STC Pay?
3. Should kitchen assignments be allowed to override user choices automatically when out-of-stock, or only after user confirmation?
4. Do we need audit trails for assignments and snapshot changes?
