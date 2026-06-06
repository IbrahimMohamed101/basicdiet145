# Flutter Guest Mode Integration

## Purpose

Guest mode lets Apple review and first-time mobile users open the app and browse public food content without creating an account. It is a browse-only session, not a customer account.

## Allowed Guest Screens

- One-time menu browsing
- Subscription plans browsing

## Disallowed Guest Actions

- Placing one-time orders
- Checkout and payment
- Subscription creation or checkout
- Profile viewing or editing
- Account deletion or account updates
- Saved meal planner actions
- Confirming subscription days
- Dashboard, admin, courier, kitchen, and pickup operations

## Guest Auth Endpoint

Primary endpoint:

```http
POST /api/auth/guest
```

Compatibility endpoint:

```http
POST /api/app/guest
```

The guest token is optional for public browsing. Use it only if the Flutter app needs a session concept for app review UX or local state. It must be stored separately from a real client token.

Example response from `/api/auth/guest`:

```json
{
  "ok": true,
  "status": "guest",
  "accessToken": "...",
  "expiresIn": 1800,
  "user": {
    "id": "guest",
    "role": "guest",
    "isGuest": true
  }
}
```

## API Examples

Get guest token:

```sh
curl -X POST https://basicdiet145.onrender.com/api/auth/guest
```

Get one-time menu:

```sh
curl https://basicdiet145.onrender.com/api/orders/menu
```

Get subscription plans:

```sh
curl https://basicdiet145.onrender.com/api/plans
```

Restricted action response:

```json
{
  "ok": false,
  "error": {
    "code": "GUEST_ACCESS_NOT_ALLOWED",
    "message": "Please sign in to continue."
  }
}
```

## Flutter Behavior

- On launch, show menu and subscription plan browsing without requiring login.
- If a guest token is used, store it in a separate guest session slot, not in the real user auth token slot.
- When the user taps order, checkout, subscription creation, profile, saved planner, or confirmation actions, show the login/register screen.
- After login or registration, replace guest state with the real client access token and refresh token.
- Never send the guest token to checkout, profile, order, subscription write, dashboard, courier, kitchen, or pickup endpoints.

## Error Handling

- `GUEST_ACCESS_NOT_ALLOWED`: show login/register because the user is browsing as a guest.
- `UNAUTHORIZED`, `AUTH_REQUIRED`, `TOKEN_INVALID`, `TOKEN_EXPIRED`: clear the invalid auth state and ask the user to sign in.

## QA Checklist

- Fresh install opens to browseable menu content without login.
- Subscription plans load without login.
- Optional guest token can be created with `/api/auth/guest`.
- Tapping checkout/order/subscription creation as guest shows login/register.
- Tapping profile as guest shows login/register.
- Saved planner selection and confirm actions are unavailable or redirect to login.
- After login, guest token is discarded and real client token is used.
- Logout returns to guest browsing without exposing account data.

## Apple Review Notes

- Reviewers can browse app menu content and subscription plans without logging in.
- Purchasing, subscription, order, payment, profile, and account actions require sign in.
- Guest sessions are stateless and do not create fake customer accounts.
