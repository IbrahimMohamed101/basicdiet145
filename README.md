# Basic Diet Backend API

**The central Node.js/Express API powering the Basic Diet mobile application and operations dashboard.**

The backend manages authentication, customer accounts, subscription lifecycles, meal catalogs, one-time ordering, add-ons, payments, fulfilment-related workflows, media, dashboard operations and shared business rules across the Basic Diet platform.

---

## Platform Role

Basic Diet is a multi-client product ecosystem:

| Component | Responsibility | Repository |
| --- | --- | --- |
| Backend API | Shared business logic, persistence, authentication and platform contracts | `Basic-Diet/backend` |
| Operations Dashboard | Internal administration and operational workflows | [`Basic-Diet/client_dashbourd`](https://github.com/Basic-Diet/client_dashbourd) |
| Mobile App | Customer-facing Flutter application | [`Basic-Diet/mobile_app`](https://github.com/Basic-Diet/mobile_app) |
| Documentation | Engineering and workflow references | `Basic-Diet/documentations` |

The backend is the authoritative layer for security-sensitive rules and business-state transitions. Frontend clients consume its APIs rather than reproducing core business logic independently.

## Core Domains

The codebase contains API and business logic for areas including:

### Authentication & Accounts

- Customer/application authentication
- Dashboard authentication
- JWT-based sessions
- Password/account flows
- Account deletion
- Dashboard staff-user management

### Subscriptions

- Subscription creation
- Subscription lifecycle policies
- Current-subscription resolution
- Freeze/extend/fulfilment-related logic
- Subscription day modifications
- Subscription balance handling
- Add-on entitlement allocation
- Subscription/menu compatibility contracts

### Menu & Meal Planning

- Meal planner APIs
- Menu/catalog management
- Custom meals
- Custom salads
- Premium meal flows
- Add-on groups and entitlements
- Weight/step pricing contracts
- Menu identity and catalog integrity tools

### Orders & Checkout

- Subscription checkout
- One-time orders
- Order lifecycle operations
- Pickup-related flows
- Concurrency-sensitive checkout/order tests

### Payments & Accounting

- Payment initialization/integration support
- Payment-related indexes and diagnostics
- Dashboard accounting endpoints and daily-report behavior
- Payment/security logging tests

### Operations

- Courier-related routes
- Dashboard operations
- Manual deduction workflows
- Pickup-location administration
- Notifications/content endpoints

## Technology Stack

### Runtime & API

- **Node.js 20+**
- **Express 4**
- **JavaScript / CommonJS**

### Database

- **MongoDB**
- **Mongoose**
- MongoDB native driver where required

### Authentication & Security

- **jsonwebtoken**
- **bcryptjs**
- **Helmet**
- **express-rate-limit**
- **CORS**

### Media & Platform Services

- **Cloudinary**
- **Multer**
- **Firebase Admin**

### Documentation & Observability

- **Swagger / swagger-jsdoc / swagger-ui-express**
- **Winston** logging

### Testing

- **Jest**
- **Mocha**
- **Chai**
- **Supertest**
- **Sinon**
- **mongodb-memory-server**

## Application Structure

```text
src/
├── index.js              # Application entry point
├── app.js                # Express app setup
├── db.js                 # Database connection
├── config/               # Runtime configuration
├── constants/            # Shared constants
├── content/              # Shared/static content concerns
├── controllers/          # HTTP request handlers
├── docs/                 # API-related docs helpers
├── jobs/                 # Background/maintenance jobs
├── locales/              # Localized response/content support
├── mappers/              # Response/domain mapping helpers
├── middleware/           # Authentication, security and request middleware
├── models/               # Mongoose models
├── routes/               # API route definitions
├── scripts/              # Operational/maintenance scripts
├── services/             # Business logic
├── types/                # Shared type/documentation helpers
└── utils/                # Reusable utilities
```

This separation keeps routing, request handling, data models and business services independent enough to evolve without concentrating all platform logic in route files.

## API Surface

The route layer is divided across public/customer, dashboard and operational concerns. Examples include:

- Authentication
- Customer/client APIs
- Admin/dashboard APIs
- Add-ons
- Custom meals and salads
- Premium meals
- Meal planner/menu APIs
- Subscriptions
- One-time orders
- Courier operations
- Content
- Accounting

For detailed contracts, use the integration documentation stored in this repository instead of relying on the README as an endpoint-by-endpoint reference.

## API Documentation

Available documentation includes:

- `API_INTEGRATION_GUIDE.md`
- `MEAL_PLANNER_INTEGRATION.md`
- `docs/auth/flutter-otp-auth-integration.md`
- `docs/MEAL_PLANNER_TEST_COVERAGE.md`

The repository also includes Swagger tooling for API documentation and inspection where configured by the running environment.

## Security Model

Security controls represented in the backend include:

- JWT authentication
- Password hashing with bcrypt
- Security headers through Helmet
- CORS configuration
- Rate limiting
- Public API surface tests
- Webhook/security hardening tests
- Backend-enforced permissions for protected dashboard operations

> Frontend route protection is not treated as the security boundary. Authorization rules are enforced by the backend.

## Testing & Release Gates

This backend contains a substantial automated test and validation surface.

Examples of covered areas include:

- Checkout
- Checkout concurrency
- One-time orders
- Subscription rules
- Fulfilment concurrency
- Security hardening
- Public API surface
- Webhooks
- Mobile API contracts
- Payment initialization/logging
- Dashboard user search
- Kitchen/read-only permissions
- Manual deductions
- Accounting
- Weight pricing
- Premium-meal lifecycle
- Add-on entitlement and balance behavior
- Database reset safety
- Catalog integrity

A consolidated release-gate command is available in `package.json` and combines core tests with validation scripts before release/handoff.

Useful commands include:

```bash
npm test
npm run test:integration
npm run test:security
npm run test:checkout
npm run test:orders
npm run test:subscriptions
npm run test:release-gates
npm run validate:backend
```

## Operational Tooling

The repository contains scripts for controlled operational tasks such as:

- Seeding demo/initial data
- Bootstrapping dashboard/super-admin accounts
- Creating production indexes
- Auditing active subscriptions and catalog conflicts
- Validating data integrity
- Backfilling catalog/display data
- Diagnosing production-like data issues
- Controlled handover/reset checks

Several destructive or production-sensitive operations require explicit flags/environment configuration rather than running implicitly.

## Environment

Typical required configuration includes:

```env
PORT=
MONGODB_URI=
JWT_SECRET=
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

Additional environment variables may be required for Firebase, payments, webhooks, CORS policy or deployment-specific integrations.

Never commit production credentials to the repository.

## Local Development

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

### Run tests

```bash
npm test
```

## Engineering Principles

- Keep HTTP concerns in routes/controllers and business logic in services where possible.
- Treat backend contracts as the authority shared by dashboard and mobile clients.
- Add tests for state transitions, authorization and concurrency-sensitive workflows.
- Prefer idempotent or guarded operational scripts for production maintenance.
- Keep media/storage concerns behind shared service abstractions.
- Validate data migrations/backfills before applying them to production data.

## Project Status

This repository represents the completed backend platform delivered for Basic Diet and continues to support maintenance, fixes and operational evolution as required.

## License

This project is proprietary software developed for the Basic Diet platform. All rights reserved unless otherwise stated by the project owners.
