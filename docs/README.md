# Project Documentation

This folder contains project documentation for BasicDiet145.

For frontend implementation, use only `docs/frontend-handoff/`. It is the final frontend implementation source of truth. Old audits, planning docs, and historical reports are useful context, but they may contain outdated plans and are not the current frontend source of truth.

For dashboard API implementation, treat `docs/dashboard-api/openapi.dashboard.json` and `docs/dashboard-api/DASHBOARD_API_GUIDE.md` as the primary references. Cleanup decisions and follow-up recommendations are tracked in `docs/DOCS_CLEANUP_RECOMMENDATIONS.md`.

| Folder | Purpose | Audience | Source of truth? |
| --- | --- | --- | --- |
| `frontend-handoff` | Final dashboard frontend implementation docs | Frontend | Yes |
| `dashboard-api` | Dashboard API contracts and generated API docs | Frontend/Backend | Yes for API |
| `one-time-orders` | One-Time Order specific docs | Frontend/Backend | Reference |
| `backend` | Backend QA, release, validation, and production readiness docs | Backend | Reference |
| `product-flows` | Cross-product flow contracts | Frontend/Backend/Product | Reference |
| `meal-planner` | Meal planner contracts, audits, and coverage notes | Frontend/Backend/QA | Reference |
| `audits` | Historical audits, plans, and reports | Backend/Product | No, historical |

## Quick Links

- Frontend source of truth: [`frontend-handoff/`](frontend-handoff/)
- Dashboard API primary references: [`dashboard-api/openapi.dashboard.json`](dashboard-api/openapi.dashboard.json) and [`dashboard-api/DASHBOARD_API_GUIDE.md`](dashboard-api/DASHBOARD_API_GUIDE.md)
- One-Time Orders: [`one-time-orders/`](one-time-orders/)
- Backend readiness and validation: [`backend/`](backend/)
- Product flow contracts: [`product-flows/`](product-flows/)
- Meal planner docs: [`meal-planner/`](meal-planner/)
- Historical audits and plans: [`audits/`](audits/)
- Cleanup recommendations: [`DOCS_CLEANUP_RECOMMENDATIONS.md`](DOCS_CLEANUP_RECOMMENDATIONS.md)
