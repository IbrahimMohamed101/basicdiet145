# Production rollout: mobile update candidate

## Source of truth

- Candidate branch: `release/mobile-app-update-20260823`
- Promote this exact branch only after the Flutter release is approved.
- Never copy the isolated Staging MongoDB URI into Production.

## Required production configuration

Apply the complete stacking block in one Railway variable update. A partial
configuration intentionally fails startup.

```dotenv
SUBSCRIPTION_STACKING_PRODUCTION_CONFIRMED=true
SUBSCRIPTION_STACKING_SHADOW_ENABLED=true
SUBSCRIPTION_STACKING_READ_ENABLED=true
SUBSCRIPTION_STACKING_WRITE_ENABLED=true
SUBSCRIPTION_STACKING_ALLOW_ALL_USERS=true
SUBSCRIPTION_STACKING_EXTRA_ACTIVATION_ENABLED=true
SUBSCRIPTION_STACKING_EXTRA_SELECTION_ENABLED=true
```

The old per-user allowlists are not required when `ALLOW_ALL_USERS=true`.

Email OTP requires the following production values. Secrets must be configured
in Railway and must never be committed:

```dotenv
AUTH_EMAIL_OTP_ENABLED=true
EMAIL_DELIVERY_PROVIDER=gmail_api
GMAIL_USER=<production sender Gmail address>
GMAIL_OAUTH_CLIENT_ID=<secret>
GMAIL_OAUTH_CLIENT_SECRET=<secret>
GMAIL_OAUTH_REFRESH_TOKEN=<secret>
EMAIL_FROM_NAME=Basic Diet
EMAIL_OTP_HASH_SECRET=<independent strong secret>
EMAIL_OTP_TTL_MINUTES=5
EMAIL_OTP_RESEND_SECONDS=60
EMAIL_OTP_MAX_ATTEMPTS=5
EMAIL_RESET_TOKEN_TTL_MINUTES=10
EMAIL_OTP_TEST_MODE=false
REFRESH_TOKEN_EXPIRES_DAYS=60
```

Keep every OTP/test-auth bypass disabled in Production:

```dotenv
OTP_TEST_MODE=false
EMAIL_OTP_TEST_MODE=false
ALLOW_TEST_AUTH=false
ALLOW_STAGING_TEST_AUTH=false
```

Promo display introduces no new environment variables.

## Deployment order

1. Confirm the candidate commit still matches the certified Staging commit.
2. Confirm Production MongoDB and payment credentials are unchanged and live.
3. Run `npm run indexes:production` against Production before enabling traffic.
4. Apply all variables above in one batch.
5. Deploy the candidate commit.
6. Require `/health` to return HTTP 200 and `db.state=up`.
7. Verify existing login, email OTP, `/api/plans`, subscription overview, and
   selection reads before announcing the Flutter update.
8. Perform one controlled live subscription purchase, then reconcile Payment,
   CheckoutDraft, Subscription, entitlement batches, allocations, Premium, and
   Add-on balances.

## Rollback

If startup or reconciliation fails, restore the previous Backend deployment and
set `SUBSCRIPTION_STACKING_PRODUCTION_CONFIRMED=false` together with all stacking
rollout flags set to `false`. Do not modify balances manually during rollback.
