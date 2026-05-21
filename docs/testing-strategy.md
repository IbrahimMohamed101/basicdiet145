# Backend Testing Strategy

This document outlines the testing strategy for the backend project, including available test suites, runners, and environmental requirements.

## Overview

The project contains a large number of test files (~58) ranging from unit tests to complex integration tests. To maintain developer velocity and system stability, we use a tiered testing approach.

## Test Tiers

### 1. Fast Unit / Contract Tests
These tests mock external dependencies (like MongoDB) and run in milliseconds.
- **Command**: `npm run test:fast` (or `npm test`)
- **When to run**: During active development (every few minutes).

### 2. Critical Path / Handoff Tests
A curated set of tests covering Checkout, Orders, Subscriptions, and Mobile API contracts.
- **Command**: `npm run test:changed-contracts`
- **When to run**: Before handing off changes to the frontend team or opening a PR.
- **Requirements**: Requires a valid `MONGO_URI`.

### 3. Full Regression
Runs every `*.test.js` file under `tests/` with automated logging, timeouts, and per-file MongoDB isolation.
- **Command**: `npm run test:all`
- **When to run**: Before production deployment or weekly stability checks.
- **Output**: Logs and summaries are written to `test-reports/`.

## Environment Setup

### MongoDB Requirement
Most integration tests require a running MongoDB instance. You must provide the connection string via the `MONGO_URI` environment variable.

```bash
export MONGO_URI="mongodb://user:pass@localhost:27017/dbname"
npm run test:all
```

The full and critical runners replace the database segment with a short deterministic per-test database name, for example `bd145_a1b2c3d4_test`, and drop that isolated test database before running the file. Names are derived from a hash of the test path, use only letters, numbers, and underscores, stay well below Atlas' 38-byte database-name limit, and still end in `_test` for safety guards. The runner also exports the same isolated value as both `MONGO_URI` and `MONGODB_URI` for the child process so shell-level settings cannot leak between files.

If `MONGO_URI` is missing, the automated runner will skip Mongo-backed tests to prevent hanging or mass failures.

## Test Categories

| Command | Focus Area | Files Included |
|---------|------------|----------------|
| `npm run test:checkout` | Subscription Checkout | `tests/checkout.integration.test.js` |
| `npm run test:orders` | One-time Orders | `tests/oneTimeOrderOps.test.js`, `tests/oneTimeOrderFullFlow.test.js` |
| `npm run test:subscriptions` | Subscription Policy | `tests/subscriptionBalancePolicy.test.js`, etc. |
| `npm run test:security` | Security / CORS | `tests/corsPreflight.test.js`, `tests/securityHardening.test.js`, etc. |
| `npm run test:mobile-contracts` | Flutter API Parity | `tests/mobileApiContracts.test.js`, `tests/fulfillmentContract.test.js`, etc. |

## Troubleshooting

- **Logs**: Check `test-reports/full-test-run.log` for detailed output.
- **Timeouts**: The runner imposes a 180s timeout per file. Files that timeout are listed in `test-reports/timeout-tests.log`.
- **Failures**: Failed files are listed in `test-reports/failed-tests.log`.
- **Failure details**: Full output for each failed or timed-out test is written to `test-reports/failed-details/<safe-test-name>.log`.

## Why not run 50+ files manually?
Manually running `node tests/xyz.test.js` is prone to error and doesn't provide consistent logging or environment handling. The automated runners ensure:
1. `NODE_ENV=test` is always set.
2. Resource cleanup through timeouts.
3. Proper skip logic when dependencies are missing.
4. Consolidated reporting for CI/CD readiness.
