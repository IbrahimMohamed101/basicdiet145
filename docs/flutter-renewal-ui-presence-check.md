# Flutter Renewal UI Presence Check

**Check Date:** 2026-07-04  
**Inspector:** Antigravity (automated static inspection)  
**Flutter path:** `/home/hema/Projects/full app/mobile_app`  
**Backend path:** `/home/hema/Projects/basicdiet145` (reference only)

---

## A. Verdict

**RENEWAL_UI_NOT_IMPLEMENTED**

The networking, data, domain, and DI layers for subscription renewal are fully wired. No user-facing screen, button, route, or BLoC/Cubit exists that allows a user to trigger subscription renewal. The feature is invisible to users.

---

## B. Evidence

### Files confirming renewal backend/data layers EXIST

| File | Line | Evidence |
|------|------|---------|
| `lib/data/network/app_api.dart` | 133–142 | `@GET renewal-seed` and `@POST /renew` Retrofit declarations |
| `lib/data/network/app_api.g.dart` | 583–625 | Generated Retrofit implementation for both methods |
| `lib/data/data_source/remote_data_source.dart` | 106–107 | Interface declarations for both methods |
| `lib/data/data_source/remote_data_source_impl.dart` | 224–235 | Concrete implementations forwarding to Retrofit client |
| `lib/data/response/subscription_renewal_seed_response.dart` | 1–23 | `SubscriptionRenewalSeedResponse` DTO (uses `Map<String, dynamic>? data`) |
| `lib/data/mappers/subscription_renewal_seed_mapper.dart` | 1–9 | Mapper: `SubscriptionRenewalSeedResponse → SubscriptionRenewalSeedModel` |
| `lib/domain/model/subscription_renewal_seed_model.dart` | full | Domain model (`Map<String, dynamic> data`) |
| `lib/domain/repository/repository.dart` | 99–101 | Abstract `getSubscriptionRenewalSeed` and `renewSubscription` |
| `lib/data/repository/repository.dart` | 656–681 | Concrete repository with error handling and mapping |
| `lib/domain/usecase/get_subscription_renewal_seed_usecase.dart` | full | `GetSubscriptionRenewalSeedUseCase` |
| `lib/domain/usecase/renew_subscription_usecase.dart` | full | `RenewSubscriptionUseCase` with `RenewSubscriptionInput` |
| `lib/app/dependency_injection.dart` | 233–238 | Both use cases registered in DI container |

### Files confirming renewal UI does NOT EXIST

| Location | Observation |
|----------|-------------|
| `lib/presentation/` — full recursive grep for `renew\|Renewal\|تجديد` | **Zero matches** in any presentation file |
| `lib/presentation/plans/manage_subscription/manage_subscription_screen.dart` | Contains: Cancel, Freeze, Skip, Delivery Settings sub-screens. **No Renew action item or button.** |
| `lib/presentation/plans/widgets/plans_action_buttons.dart` | Two buttons only: "View Timeline" and "Today's Meals". **No Renew button.** |
| `lib/presentation/plans/widgets/subscription_plan_card.dart` | Shows plan info + "Manage" chip (navigates to manage screen). **No Renew button.** |
| `lib/presentation/plans/widgets/no_subscription_view.dart` | Shows when no active subscription is found. Single CTA: "Explore Our Plans" → navigates to `SubscriptionScreen` (new subscription flow). **No renewal path.** |
| `lib/presentation/resources/routes_manager.dart` | Routes: checkout, manage-account, main tabs. **No renewal route.** |
| `lib/presentation/resources/strings_manager.dart` | **Zero renewal-related string keys** (`renew`, `Renew`, `Renewal`, `تجديد`) |

---

## C. Current Renewal Stack

| Layer | Component | Status |
|-------|-----------|--------|
| **Retrofit methods** | `getSubscriptionRenewalSeed()`, `renewSubscription()` in `app_api.dart` | ✅ Exists |
| **Generated Retrofit** | `app_api.g.dart` lines 583–625 | ✅ Generated and current |
| **DataSource interface** | `remote_data_source.dart:106–107` | ✅ Exists |
| **DataSource impl** | `remote_data_source_impl.dart:224–235` | ✅ Exists |
| **Repository interface** | `domain/repository/repository.dart:99–101` | ✅ Exists |
| **Repository impl** | `data/repository/repository.dart:656–681` | ✅ Exists |
| **Renewal seed DTO** | `subscription_renewal_seed_response.dart` | ✅ Exists (untyped `Map<String,dynamic>` data) |
| **Renewal seed mapper** | `subscription_renewal_seed_mapper.dart` | ✅ Exists |
| **Renewal seed domain model** | `subscription_renewal_seed_model.dart` | ✅ Exists |
| **Use case: get seed** | `GetSubscriptionRenewalSeedUseCase` | ✅ Registered in DI |
| **Use case: renew** | `RenewSubscriptionUseCase` | ✅ Registered in DI |
| **BLoC / Cubit** | None for renewal | ❌ Does not exist |
| **UI screen** | None for renewal | ❌ Does not exist |
| **UI route** | None for renewal | ❌ Does not exist |
| **Entry point button/CTA** | None in any existing screen | ❌ Does not exist |
| **Renewal strings** | None in strings_manager.dart | ❌ Does not exist |

---

## D. Required Next Action

**Renewal UI must be created.** The backend layers and domain layers are ready. What needs to be built:

### Minimum required Flutter additions

#### 1. BLoC or Cubit — `RenewalBloc` (or Cubit)
- Loads seed via `GetSubscriptionRenewalSeedUseCase`
- Submits renewal via `RenewSubscriptionUseCase`
- Handles loading / success / error states
- Produces a `SubscriptionCheckoutModel` on success (same model used for new checkouts)

#### 2. Renewal screen — `RenewalScreen`
- Accepts `subscriptionId` as input
- Loads the renewal seed to pre-fill:
  - Delivery mode (from seed's prior delivery config)
  - `firstDayFulfillmentOverride` (if pickup today is available)
  - Plan details (meals/day, duration)
- Displays pricing summary before confirmation
- Submits renewal request with full `SubscriptionCheckoutRequest`, **preserving `delivery.firstDayFulfillmentOverride`**
- On success: shows confirmation, optionally navigates back to plans screen and refreshes overview

#### 3. Entry point CTA
**Recommended locations (one or both):**
- **`ManageSubscriptionScreen`** — Add a "Renew Subscription" action item row (alongside Cancel, Freeze, Skip). This is the natural location for an active subscription.
- **`NoSubscriptionView`** — If the previous subscription ID is available, add a "Renew Previous Plan" secondary button alongside the existing "Explore Our Plans" CTA. This surfaces renewal when the sub is expired.

#### 4. String keys
Add to `strings_manager.dart`:
```
renewSubscription
renewSubscriptionTitle
renewSubscriptionSubtitle
renewSubscriptionConfirm
renewSuccessTitle
renewSuccessSubtitle
```

#### 5. Route (optional)
Add a named route in `routes_manager.dart` if the renewal screen is navigated to from multiple places.

### What does NOT need to be built
- Retrofit methods — already exist
- DataSource / Repository / Use cases — already exist and are DI-registered
- The checkout/payment flow itself — renewal reuses `SubscriptionCheckoutResponse`, which is the same as new subscription checkout, so the existing checkout status polling logic should be reusable

### Business rules to enforce in the UI
| Rule | Implementation |
|------|----------------|
| Read `resolvedStartDate` from backend renewal response | Do **not** compute start date client-side |
| When pickup today is chosen: include `delivery.firstDayFulfillmentOverride` | Populate from seed or user selection |
| When delivery only: omit `firstDayFulfillmentOverride` | `null`/absent in request |
| Day 1 pickup + Day 2+ delivery split comes from backend | Do not hard-code assumptions |

### Summary
The backend is ready. The data layer is ready. The domain layer is ready. **Only the presentation layer (screen, bloc, entry point) needs to be created.** This is a greenfield UI feature, not a bug fix.
