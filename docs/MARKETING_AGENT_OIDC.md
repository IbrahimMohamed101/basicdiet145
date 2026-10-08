# Machine-to-machine Marketing OS link (GitHub OIDC)

**Security model:** New independent /api/marketing-agent/commercial-report endpoint, GET-only and default disabled.
The existing dashboard /api/dashboard/accounting/marketing-analytics remains unchanged and protected by admin auth.

## Who may call it?

Only GitHub Actions OIDC signed by GitHub RSA JWKS with all of:
- Issuer https://token.actions.githubusercontent.com and audience basicdiet-marketing-analytics-v1
- GitHub repository IbrahimMohamed101/basicdiet-marketing-os, immutable repo ID 1410360280, owner ID 108367693.
- Private visibility and main branch refs/heads/main.
- Exact workflow IbrahimMohamed101/basicdiet-marketing-os/.github/workflows/sync-commerce.yml@refs/heads/main.
- Events workflow_dispatch or schedule; validated signature, kid, nbf, iat, exp.

No admin username/password or dashboard access token copied into the marketing repository.

## Deployment gate

Environment variable MARKETING_AGENT_OIDC_ENABLED=true on the backend Railway service only.
Absent/false: 404 response without executing analytics.
Invalid identity or ordinary dashboard JWT: 401; no analytics run.

## Endpoint

GET /api/marketing-agent/commercial-report?from=YYYY-MM-DD&to=YYYY-MM-DD

Range must cover exactly 30, 60 or 90 inclusive Saudi days.
Only aggregate KPI counts, halala revenue and rates, bounded plan/promo/source/delivery/provider/day breakdowns are returned.
No client user IDs, phones, personal details, payment records, free-text notes, MongoDB exports or app sessions.

Existing buildMarketingAnalyticsReport() is used for data collection without changing query or write paths.

## Limitations

- No installs/first_open or campaign-to-first-paid attribution in current backend analytics.
- Machine identity grants no access to admin pages or other protected endpoints.
- Production roundtrip must be verified after deploy with a real OIDC token from the exact Actions workflow.
- Social OAuth accounts must be connected separately through provider authorization and store credentials outside Git.

## Contract test

NODE_ENV=test node -r ./tests/helpers/installMongoTestSafetyGuard.js tests/marketingAgentOidc.test.js
