# Account Bootstrap

Use `scripts/create_default_accounts.js` to recreate missing safe default accounts without deleting or resetting data.

The script is idempotent:

- Creates an account only when it is missing.
- Skips existing dashboard users by email.
- Skips existing mobile users when either the core `User` or linked `AppUser` phone already exists.
- Never overwrites passwords, roles, active flags, profile fields, sessions, or existing records.
- Uses the project password hashing services and Mongoose models.

## Dashboard Accounts

| Label | Email | Role | Password |
| --- | --- | --- | --- |
| Super Admin | `admin@basicdiet.com` | `superadmin` | `Admin@123456` |
| Admin | `manager@basicdiet.com` | `admin` | `Manager@123456` |
| Kitchen | `kitchen@basicdiet.com` | `kitchen` | `Kitchen@123456` |
| Courier | `courier@basicdiet.com` | `courier` | `Courier@123456` |
| Pickup | `pickup@basicdiet.com` | `cashier` | `Pickup@123456` |

The current dashboard auth enum does not contain a literal `pickup` role. Pickup/customer-consumption dashboard routes use the existing `cashier` role, so the pickup default account is created as `cashier`.

## Mobile App Accounts

| Label | Phone | Full Name | Password |
| --- | --- | --- | --- |
| Test Client 1 | `+201000000001` | `Test Client One` | `Client@123456` |
| Test Client 2 | `+201000000002` | `Test Client Two` | `Client@123456` |

Mobile accounts are created as verified client users with linked `app_users` records.

## Run

```bash
npm run bootstrap:accounts
```

Required environment:

- `MONGO_URI` or `MONGODB_URI`
- `DASHBOARD_JWT_SECRET`
- `JWT_ACCESS_SECRET` or `JWT_SECRET`

## Production Safety

The script refuses to run when `NODE_ENV=production` unless this is explicitly set:

```bash
ALLOW_ACCOUNT_BOOTSTRAP=true npm run bootstrap:accounts
```

Use that flag only for the one run where bootstrap is intended, then remove it from the environment.

## Verification

After create/skip checks, the script verifies compatibility with the auth stack:

- Dashboard password hash comparison when the stored password matches the configured default.
- Dashboard JWT generation and token payload shape.
- Dashboard role enum compatibility.
- Mobile password hash comparison when the stored password matches the configured default.
- Mobile app JWT generation and token payload shape.
- Client role and verified phone flags.

Existing accounts are not modified. If an existing account has a changed password, verification may print a warning because the script cannot prove the default password is still valid without overwriting it.

## Changing Passwords

For dashboard users, change passwords through the dashboard admin password reset flow or the existing `scripts/create-dashboard-user.js` utility when an intentional reset is needed.

For mobile users, use the normal password reset flow:

- `POST /api/auth/password/forgot`
- `POST /api/auth/password/reset`

## Disable After Use

After the bootstrap run:

- Remove `ALLOW_ACCOUNT_BOOTSTRAP` from production/staging environment variables.
- Rotate these default passwords through the normal auth flows.
- Avoid running this script as part of deployment, migrations, or seed jobs.
