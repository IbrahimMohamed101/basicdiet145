# Railway Database Handover Reset

Use this runbook only when the current Railway MongoDB data is disposable QA/demo data and the project owner has approved a clean handover database.

## Safety model

The reset command is dry-run by default. Execution requires all of the following at the same time:

- `--execute`
- `ALLOW_DATABASE_RESET=true`
- `BACKUP_CONFIRMED=true`
- `RESET_DATABASE_NAME` exactly matching the connected database name
- `RESET_CONFIRM_PHRASE=DELETE_FAKE_DATA_AND_REBUILD`

The command refuses MongoDB system databases: `admin`, `config`, and `local`.

The script prints the connected host, database name, collection names, and estimated document counts before evaluating execution confirmations. It never prints the MongoDB URI.

## 1. Stop writes

Temporarily stop or scale down the Railway backend service before resetting the database. This prevents requests, cron jobs, and background jobs from writing while the reset is in progress.

## 2. Take a backup

Use the Railway external MongoDB URL locally. Never commit it or paste it into documentation.

```bash
export MONGO_URI='<Railway external MongoDB URL>'
mkdir -p backups
mongodump \
  --uri="$MONGO_URI" \
  --archive="backups/basicdiet-before-reset-$(date +%Y%m%d-%H%M%S).archive" \
  --gzip
ls -lh backups/
```

Backups are ignored by Git and should be copied to approved secure storage.

## 3. Inspect the target without deleting

```bash
MONGO_URI="$MONGO_URI" npm run db:handover-reset:check
```

Confirm all of the following from the output:

- Host belongs to the intended Railway MongoDB service.
- Database name is correct.
- Collection and document counts match the disposable environment.
- No real customer, order, subscription, or payment data must be retained.

## 4. Execute the reset

Replace `basicdiet145` below if the dry-run reports a different intended database name.

```bash
ALLOW_DATABASE_RESET=true \
BACKUP_CONFIRMED=true \
RESET_DATABASE_NAME=basicdiet145 \
RESET_CONFIRM_PHRASE=DELETE_FAKE_DATA_AND_REBUILD \
MONGO_URI="$MONGO_URI" \
npm run db:handover-reset
```

The command drops the connected application database. It does not automatically seed data, create accounts, or restart Railway.

## 5. Rebuild canonical application data

```bash
MONGO_URI="$MONGO_URI" npm run bootstrap:data:sync
MONGO_URI="$MONGO_URI" npm run indexes:production
```

Do not run `seed`, `seed:full`, or QA-specific seed commands for a clean handover database.

Create only the real handover dashboard account using the approved account workflow:

```bash
MONGO_URI="$MONGO_URI" npm run create:dashboard-user
```

Default/demo accounts remain excluded unless account bootstrap is explicitly enabled.

## 6. Validate before restarting traffic

```bash
MONGO_URI="$MONGO_URI" npm run catalog:check
MONGO_URI="$MONGO_URI" npm run validate:data
```

Restart the Railway backend and verify:

- `/live`
- `/ready`
- `/health`
- Dashboard login
- Package list and details
- Menu and add-on catalog
- Pickup locations and delivery zones
- `GET /api/dashboard/premium-upgrades/readiness`

Premium readiness should report no missing sources, invalid relations, or duplicate active keys.

## 7. Final handover checks

The final database should contain canonical configuration and catalog data only, plus explicitly approved real accounts. It should not contain disposable QA users, orders, subscriptions, payments, checkout drafts, OTP records, fake notifications, or test activity logs.

Keep the pre-reset backup until the customer formally accepts the handover.
