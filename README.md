# Basic Diet Backend API

**The authoritative Node.js/Express backend powering the Basic Diet mobile application and operations dashboard.**

This service owns the platform's security-sensitive rules, persistence, subscription lifecycle, meal and catalog contracts, ordering flows, payment-related operations, fulfilment logic, dashboard administration APIs, operational tooling, and release-validation scripts.

---

## Table of Contents

- [Platform Role](#platform-role)
- [System Architecture](#system-architecture)
- [Core Business Domains](#core-business-domains)
- [Technology Stack](#technology-stack)
- [Codebase Structure](#codebase-structure)
- [Request Lifecycle](#request-lifecycle)
- [Authentication and Security](#authentication-and-security)
- [Subscriptions and Entitlements](#subscriptions-and-entitlements)
- [Menu, Meal Builder, and Catalog](#menu-meal-builder-and-catalog)
- [Orders, Checkout, and Fulfilment](#orders-checkout-and-fulfilment)
- [Payments and Accounting](#payments-and-accounting)
- [API Documentation](#api-documentation)
- [Testing Strategy](#testing-strategy)
- [Release Gates](#release-gates)
- [Operational Scripts](#operational-scripts)
- [Environment Configuration](#environment-configuration)
- [Local Development](#local-development)
- [Production and Handover Safety](#production-and-handover-safety)
- [Engineering Principles](#engineering-principles)
- [Related Repositories](#related-repositories)
- [Project Status](#project-status)
- [License](#license)

---

## Platform Role

Basic Diet is a multi-application product ecosystem:

| Component | Responsibility | Repository |
| --- | --- | --- |
| **Backend API** | Security, persistence, business logic, authoritative platform contracts | `Basic-Diet/backend` |
| **Operations Dashboard** | Internal operational interface | [`Basic-Diet/client_dashbourd`](https://github.com/Basic-Diet/client_dashbourd) |
| **Mobile App** | Customer-facing Flutter application | [`Basic-Diet/mobile_app`](https://github.com/Basic-Diet/mobile_app) |
| **Engineering Documentation** | Cross-repository workflow references | `Basic-Diet/documentations` |

The backend is the source of truth for state transitions that cannot safely be enforced in client applications alone.

Examples include:

- Authentication and authorization
- Subscription eligibility and lifecycle policies
- Checkout and order integrity
- Add-on entitlement accounting
- Payment-related behavior
- Dashboard permissions
- Catalog consistency rules
- Concurrency-sensitive updates
- Controlled administrative operations

---

## System Architecture

```text
                 ┌────────────────────────┐
                 │     Flutter Mobile     │
                 │ customer application   │
                 └────────────┬───────────┘
                              │
                              │ REST/API contracts
                              │
┌──────────────────────┐      │      ┌─────────────────────────┐
│ Operations Dashboard │──────┼─────▶│   Basic Diet Backend    │
│ React + Vite         │      │      │ Express + MongoDB       │
└──────────────────────┘      │      │ business authority      │
                              │      └────────────┬────────────┘
                              │                   │
                              │        ┌──────────┴───────────┐
                              │        │ MongoDB / Mongoose   │
                              │        │ Cloudinary / Firebase│
                              │        └──────────────────────┘
```

The web and mobile clients consume shared backend contracts. Client applications should not duplicate authoritative business rules when those rules affect security, money, entitlement balances, subscription status, or shared data consistency.

---

## Core Business Domains

The backend contains route/controller/service/model logic across several operational domains.

### Authentication & Accounts

- Customer authentication
- Dashboard authentication
- JWT-based sessions
- Password/account flows
- Account deletion
- Dashboard staff users
- Role and permission policies for protected operational endpoints

### Subscriptions

- Subscription plan management
- Subscription creation
- Current-subscription resolution
- Subscription day modifications
- Freeze and extension-related behavior
- Balance handling
- Fulfilment-state coordination
- Bilingual subscription response contracts
- Add-on credit and entitlement allocation

### Menu & Meal Planning

- Meal planner APIs
- Weekly menu behavior
- Menu/catalog administration
- Meal-builder contracts
- Custom meals
- Custom salads
- Premium meals
- Menu identity mapping
- Menu identity suggestions/approval
- Catalog consistency validation

### Add-ons & Entitlements

- Add-on groups
- Plan-linked add-ons
- Owned add-on entitlement snapshots
- Credit allocation
- Credit release/idempotency
- Dynamic add-on groups
- Dashboard/mobile parity checks

### Orders & Checkout

- Subscription checkout
- Checkout concurrency handling
- One-time ordering
- One-time order lifecycle
- Pickup-related operations
- Order/fulfilment compatibility contracts

### Payments & Accounting

- Payment initialization behavior
- Payment-related index maintenance
- Logging around payment initialization
- Accounting-oriented dashboard endpoints
- Daily-report behavior

### Operations & Administration

- Courier routes
- Manual deduction
- Dashboard user search
- Kitchen/read-only permissions
- Pickup location administration
- Notifications/content-related endpoints
- Production indexes and operational diagnostics

---

## Technology Stack

### Runtime

- **Node.js 20+**
- **Express 4.18**
- **JavaScript / CommonJS**

### Database

- **MongoDB**
- **Mongoose 8.10**
- MongoDB native driver where direct database functionality is required

### Authentication & Security

- **jsonwebtoken**
- **bcryptjs**
- **Helmet**
- **express-rate-limit**
- **CORS**

### Media & Platform Integrations

- **Cloudinary**
- **Multer**
- **Firebase Admin**

### Documentation & Observability

- **swagger-jsdoc**
- **swagger-ui-express**
- **Winston**

### Testing

The repository uses a mixed backend testing toolchain because different test suites target different concerns:

- **Jest**
- **Mocha**
- **Chai**
- **Supertest**
- **Sinon**
- **mongodb-memory-server**

The exact installed versions and executable scripts are defined in `package.json`.

---

## Codebase Structure

```text
src/
├── index.js              # Main application entry point
├── app.js                # Express application setup
├── db.js                 # Database connection layer
├── config/               # Runtime/service configuration
├── constants/            # Shared constants and policies
├── content/              # Shared/static content concerns
├── controllers/          # HTTP request handlers
├── docs/                 # Documentation-related helpers
├── jobs/                 # Background/maintenance tasks
├── locales/              # Localized response/content support
├── mappers/              # Domain/response mapping
├── middleware/           # Auth, security, validation, request handling
├── models/               # Mongoose models
├── routes/               # REST API route definitions
├── scripts/              # Operational and maintenance tooling
├── services/             # Business logic
├── types/                # Shared type/documentation helpers
└── utils/                # Reusable utilities
```

### Why this separation matters

- Routes define HTTP entry points.
- Controllers coordinate request/response behavior.
- Services own reusable business logic.
- Models own persistence shape and indexes.
- Middleware centralizes authentication and request concerns.
- Scripts provide explicit operational tooling instead of hidden one-off production changes.

---

## Request Lifecycle

A typical protected request follows this flow:

```text
Client request
    ↓
Express route
    ↓
Authentication / validation middleware
    ↓
Controller
    ↓
Service / domain logic
    ↓
Mongoose model / external integration
    ↓
Mapper / response normalization
    ↓
HTTP response
```

Business-critical validation should happen before persistence and should not rely only on frontend validation.

---

## Authentication and Security

Security controls represented by the backend include:

- JWT authentication
- Password hashing with bcrypt
- Backend-enforced protected routes
- Role/policy checks for dashboard areas
- Security headers through Helmet
- CORS configuration
- Request rate limiting
- Public API surface tests
- Webhook hardening tests
- Checkout/security hardening tests
- Environment-based secrets

### Security boundary

```text
Mobile/Web route hiding   = usability layer
Backend authorization     = actual security boundary
Database constraints/tests= integrity layer
```

Never trust client-side route visibility as proof that an operation is authorized.

---

## Subscriptions and Entitlements

Subscriptions are one of the most important platform domains and have dedicated automated coverage.

The backend includes logic and tests around:

- Current subscription resolution
- Subscription balance policy
- Subscription day modifications
- Fulfilment concurrency
- Subscription checkout
- Subscription bilingual responses
- Subscription plan bootstrap/seeding
- Add-on selection policies
- Add-on credit allocation
- Owned add-on entitlement snapshots
- Add-on balance release and idempotency
- Add-on dashboard/mobile parity
- Owned meal entitlement

This matters because subscription state affects what a customer may order, what benefits remain available, and what the operations dashboard is allowed to change.

---

## Menu, Meal Builder, and Catalog

The platform contains several catalog layers rather than a single flat product list.

Covered backend concerns include:

- Main menu
- Weekly menu
- Meal planner
- Meal builder
- One-time menu
- Custom meals
- Custom salads
- Premium meals
- Add-ons
- Weight-step pricing
- Menu identity mapping
- Catalog health and integrity

### Catalog validation tooling

The repository includes scripts/tests for areas such as:

- Catalog health
- Menu identity validation
- Menu identity suggestions
- Builder/menu parity
- Dashboard/mobile parity
- Premium meal lifecycle
- Premium salad eligibility
- Weight-pricing authority

The catalog should therefore be treated as a governed domain with compatibility contracts, not as unvalidated arbitrary records.

---

## Orders, Checkout, and Fulfilment

The backend has dedicated coverage for the parts of ordering that are vulnerable to race conditions or state inconsistencies.

Examples include:

- Subscription checkout
- Checkout invoice concurrency
- One-time order full flow
- One-time operational actions
- Fulfilment concurrency
- Pickup-related behavior
- Mobile fulfilment contracts

### Why concurrency tests matter

Checkout, balance usage, and fulfilment transitions can produce incorrect financial or entitlement state if two requests are processed without proper guards. The repository therefore includes explicit concurrency-sensitive test suites rather than relying only on happy-path endpoint tests.

---

## Payments and Accounting

Payment-related backend behavior includes:

- Payment initialization
- Payment initialization logging
- Payment index maintenance
- Payment/security tests
- Dashboard accounting endpoints
- Daily accounting report behavior

Payment logic should remain backend-controlled and observable. Client applications should never be treated as the authoritative source for payment state.

---

## API Documentation

The repository contains dedicated integration material, including:

- `API_INTEGRATION_GUIDE.md`
- `MEAL_PLANNER_INTEGRATION.md`
- `docs/auth/flutter-otp-auth-integration.md`
- `docs/MEAL_PLANNER_TEST_COVERAGE.md`

Swagger tooling is also included through:

- `swagger-jsdoc`
- `swagger-ui-express`

Use the detailed integration documents for endpoint contracts instead of expanding this README into an endpoint-by-endpoint API specification.

---

## Testing Strategy

The backend includes a large set of targeted test commands.

### Core tests

```bash
npm test
npm run test:integration
npm run test:security
npm run test:checkout
npm run test:orders
npm run test:subscriptions
```

### Contract and compatibility tests

Examples include:

```bash
npm run test:mobile-contracts
npm run test:meal-planner-contract
npm run test:builder-catalog-v2-contract
npm run test:addon-dashboard-mobile-parity
npm run test:menu-dashboard-mobile-parity
npm run test:dashboard-subscription-create
```

### Permission and dashboard tests

Examples include:

```bash
npm run test:dashboard-staff-users
npm run test:dashboard-users-search
npm run test:kitchen-permissions
npm run test:dashboard-manual-deduction
npm run test:dashboard-accounting
```

### Data integrity tests

Examples include:

```bash
npm run test:database-reset-safety
npm run test:catalog-validator-consistency
npm run test:menu-identity
npm run test:weight-pricing
```

---

## Release Gates

A consolidated release gate is available:

```bash
npm run test:release-gates
```

This command combines the core test suite with validation and critical contract checks, including security, checkout, orders, subscriptions, add-ons, mobile contracts, payments, dashboard operations, catalog behavior, and premium-meal lifecycle coverage.

Additional broad checks include:

```bash
npm run validate:backend
npm run test:all
npm run test:changed-contracts
npm run smoke:integrity
```

### Recommended handoff expectation

Before a production handoff or high-risk backend change:

1. Run validation.
2. Run affected contract tests.
3. Run security-sensitive tests if auth/payment/order behavior changed.
4. Run `test:release-gates` for release-level confidence.
5. Review migration/backfill/seed commands separately before executing them in a real environment.

---

## Operational Scripts

The backend contains explicit scripts for controlled operational tasks.

### Bootstrap and seed

Examples:

```bash
npm run bootstrap:superadmin
npm run bootstrap:data
npm run bootstrap:new-menu
npm run seed
npm run seed:subscription-plans
npm run seed:one-time-menu
```

### Indexes and production preparation

```bash
npm run indexes:production
npm run fix:payment-indexes
```

### Diagnostics and audits

```bash
npm run diagnose:subscription-menu
npm run diagnose:client-subscription-addons
npm run audit:active-subscriptions
npm run audit:addon-category-conflicts
npm run audit:pickup-addresses
npm run catalog:check
```

### Backfills and migrations

Examples include:

```bash
npm run backfill:addon-display-key
npm run backfill:meal-categories
npm run backfill:test-weight-pricing
npm run migrate:builder-to-menu
```

Operational scripts may change data. Read the implementation and required flags before running any command against staging or production.

---

## Environment Configuration

Typical required configuration includes values such as:

```env
PORT=
MONGODB_URI=
JWT_SECRET=
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

Additional configuration may be required for:

- Firebase Admin
- CORS policy
- Payment integrations
- Webhooks
- Deployment-specific behavior
- Production bootstrap/maintenance scripts

### Environment rules

- Never commit real secrets.
- Keep development, staging, and production values separate.
- Treat destructive scripts as production-sensitive.
- Validate environment intent before running seed/reset/backfill commands.

---

## Local Development

### Requirements

- Node.js `^20.0.0`
- npm
- MongoDB
- Required external-service credentials for any integration being tested locally

### Install

```bash
git clone https://github.com/Basic-Diet/backend.git
cd backend
npm install
```

### Start

```bash
npm start
```

### Run core tests

```bash
npm test
```

---

## Production and Handover Safety

The repository includes explicit handover/reset tooling:

```bash
npm run db:handover-reset:check
npm run db:handover-reset
```

The check mode exists so destructive actions can be evaluated before execution. Similar care should be applied to:

- Production index creation
- Data cleanup
- Backfills
- Catalog migrations
- Seed synchronization
- Account bootstrap

Never run a destructive command because its name appears in this README; inspect its implementation and the current environment first.

---

## Engineering Principles

1. **Backend rules are authoritative.** Do not move security-sensitive rules to the client only.
2. **Keep HTTP and business concerns separated.** Routes/controllers coordinate; services own reusable logic.
3. **Test state transitions.** Subscription, payment, order, and entitlement changes need more than happy-path tests.
4. **Test concurrency-sensitive paths.** Checkout and fulfilment are explicitly covered for this reason.
5. **Treat catalog data as governed state.** Use validators, mappings, and health checks.
6. **Make operational scripts explicit and guarded.** Avoid undocumented manual database edits.
7. **Keep integration contracts synchronized.** Dashboard and mobile depend on shared response behavior.
8. **Preserve observability.** Payment and operational failures should be diagnosable.
9. **Never commit secrets or private production data.**
10. **Run release gates before high-confidence handoff.**

---

## Related Repositories

- [`Basic-Diet/client_dashbourd`](https://github.com/Basic-Diet/client_dashbourd) — operations dashboard
- [`Basic-Diet/mobile_app`](https://github.com/Basic-Diet/mobile_app) — customer mobile application
- `Basic-Diet/documentations` — shared engineering references

---

## Project Status

This repository represents the delivered Basic Diet backend platform and continues to support maintenance, operational refinement, compatibility changes, data-quality work, and future product evolution.

Because it is the shared authority for multiple clients, changes should be evaluated for dashboard/mobile contract impact before release.

---

## License

This project is proprietary software developed for the Basic Diet platform. All rights reserved unless otherwise stated by the project owners.
