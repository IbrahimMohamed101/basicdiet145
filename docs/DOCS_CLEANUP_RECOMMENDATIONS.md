# Docs Cleanup Recommendations

Generated: 2026-05-16

Scope: review-only pass over the organized `docs/` tree. No files were moved or deleted during this pass.

## Executive Summary

- Initial docs count reviewed: 58 files, excluding this report.
- Exact duplicate files found by SHA-256 checksum: 0.
- The docs tree is much clearer after the folder organization, but several large historical files still overlap with active references.
- The strongest source-of-truth area is `docs/frontend-handoff/`, especially for dashboard frontend implementation.
- `docs/dashboard-api/openapi.dashboard.json` should be treated as the API contract source of truth, with `endpoint-matrix.md` and Postman collections as generated or operational references.
- The riskiest overlap is in dashboard API docs: `DASHBOARD_FRONTEND_INTEGRATION_GUIDE_AR.md` says to use `/api/dashboard/meal-planner/*`, while the OpenAPI contract and dashboard guide document `/api/admin/meal-planner-menu/*`.
- No file should be deleted immediately. Deletion should only happen after extracting unique decisions from merge candidates and confirming that stale route guidance is not still needed.

## Source-Of-Truth Docs

| File | Reason |
| --- | --- |
| `docs/frontend-handoff/README.md` | Declares the final frontend handoff folder and scope. |
| `docs/frontend-handoff/frontend-dashboard-ops-readme.md` | Final dashboard operations frontend implementation guide. |
| `docs/frontend-handoff/frontend-accounting-report-readme.md` | Final daily accountant report frontend implementation guide. |
| `docs/dashboard-api/openapi.dashboard.json` | Canonical machine-readable dashboard API contract. |
| `docs/meal-planner/MEAL_PLANNER_CANONICAL_CONTRACT.md` | Canonical meal planner data contract. |

## Exact Duplicate Detection

Method: `sha256sum` over every file under `docs/`.

Result: no duplicate checksums were found.

## Classification By File

| File | Classification | Recommendation |
| --- | --- | --- |
| `docs/README.md` | active_reference | Keep as top-level navigation. |
| `docs/DOCS_CLEANUP_RECOMMENDATIONS.md` | active_reference | This report; review before acting. |
| `docs/frontend-handoff/README.md` | source_of_truth | Keep. |
| `docs/frontend-handoff/frontend-dashboard-ops-readme.md` | source_of_truth | Keep as final dashboard frontend ops guide. |
| `docs/frontend-handoff/frontend-accounting-report-readme.md` | source_of_truth | Keep as final accounting report frontend guide. |
| `docs/dashboard-api/README.md` | active_reference | Keep as dashboard API folder index. |
| `docs/dashboard-api/openapi.dashboard.json` | source_of_truth | Keep as API contract. |
| `docs/dashboard-api/endpoint-matrix.md` | active_reference | Keep as compact API reference; regenerate if OpenAPI changes. |
| `docs/dashboard-api/postman.dashboard_collection.json` | active_reference | Keep as compact Postman collection. |
| `docs/dashboard-api/postman.dashboard_full_collection.json` | active_reference | Keep as full QA/onboarding Postman collection. |
| `docs/dashboard-api/DASHBOARD_API_GUIDE.md` | active_reference | Keep as concise human API guide. |
| `docs/dashboard-api/DASHBOARD_API_README_AR.md` | merge_candidate | Keep for now; consider splitting menu-management and one-time-order content into more focused docs. |
| `docs/dashboard-api/DASHBOARD_FRONTEND_INTEGRATION_GUIDE_AR.md` | unknown_needs_human_review | Validate meal-planner route guidance against OpenAPI/current backend before keeping as active reference. |
| `docs/dashboard-api/SUBSCRIPTION_TIMELINE_AND_DAY_CONSUMPTION_LOGIC_AR.md` | active_reference | Keep as subscription timeline/day consumption reference. |
| `docs/one-time-orders/README.md` | active_reference | Keep as folder index. |
| `docs/one-time-orders/ONE_TIME_ORDER_DASHBOARD_OPS_FLOW.md` | active_reference | Keep as detailed one-time order dashboard ops reference. |
| `docs/one-time-orders/ONE_TIME_ORDER_MOBILE_FLOW.md` | active_reference | Keep as mobile one-time order reference. |
| `docs/one-time-orders/one-time-menu-catalog.md` | active_reference | Keep as menu catalog reference. |
| `docs/one-time-orders/seed-one-time-menu.js` | active_reference | Keep as seed script/reference artifact. |
| `docs/one-time-orders/ui_backend_alignment_report.md` | merge_candidate | Keep for now; extract current UI/catalog rules into `one-time-menu-catalog.md` if still valid. |
| `docs/backend/README.md` | active_reference | Keep as backend folder index. |
| `docs/backend/BACKEND_QA_CHECKLIST_AR.md` | active_reference | Keep as backend QA checklist. |
| `docs/backend/BACKEND_RELEASE_CONFIDENCE_PLAN_AR.md` | active_reference | Keep as release confidence plan. |
| `docs/backend/BACKEND_VALIDATION_STRATEGY_AR.md` | active_reference | Keep as validation strategy. |
| `docs/backend/production/PRODUCTION_READINESS_10K_AUDIT.md` | active_reference | Keep as primary 10K production readiness reference. |
| `docs/product-flows/README.md` | active_reference | Keep as product-flow index. |
| `docs/product-flows/pickup-multi-request-backend-contract.md` | active_reference | Keep separate from frontend contract. |
| `docs/product-flows/pickup-multi-request-frontend-contract.md` | active_reference | Keep separate from backend contract. |
| `docs/product-flows/unified-selection-payment-flow.md` | active_reference | Keep as focused payment troubleshooting/reference doc. |
| `docs/product-flows/frontend-subscription-addons.md` | active_reference | Keep as focused addon integration doc. |
| `docs/product-flows/vat-inclusive-subscription-pricing.md` | active_reference | Keep as pricing reference. |
| `docs/meal-planner/README.md` | active_reference | Keep as meal-planner folder index. |
| `docs/meal-planner/MEAL_PLANNER_CANONICAL_CONTRACT.md` | source_of_truth | Keep as meal planner contract. |
| `docs/meal-planner/MEAL_PLANNER_FULLSTACK_AUDIT.md` | historical_audit | Keep as historical audit unless current Flutter status still depends on it. |
| `docs/meal-planner/MEAL_PLANNER_TEST_COVERAGE.md` | active_reference | Keep as test coverage reference. |
| `docs/audits/README.md` | active_reference | Keep as historical-folder index. |
| `docs/audits/BACKEND_ARCHITECTURE_BLUEPRINT_AR.md` | historical_audit | Keep as historical architecture map. |
| `docs/audits/BACKEND_PHASE_2_PERFORMANCE_PLAN.md` | historical_audit | Keep as historical performance plan. |
| `docs/audits/BACKEND_PRODUCTION_READINESS_AUDIT.md` | merge_candidate | Merge any still-current findings into `backend/production/PRODUCTION_READINESS_10K_AUDIT.md`, then mark historical. |
| `docs/audits/CUSTOM_PREMIUM_SALAD_CONTRACT_AUDIT.md` | historical_audit | Keep as historical audit. |
| `docs/audits/DASHBOARD_PAGINATION_PLAN.md` | historical_audit | Keep as historical pagination plan. |
| `docs/audits/FLUTTER_BACKEND_GAP_ANALYSIS_REPORT.md` | deprecated_candidate | Likely superseded by later Flutter/meal-planner docs; mark historical/deprecated after human confirmation. |
| `docs/audits/FRONTEND_FLUTTER_REMOVAL_REPORT.md` | unknown_needs_human_review | File claims to be Flutter source of truth despite living in audits; either relocate to active docs or mark historical. |
| `docs/audits/FULFILLMENT_LOGIC_AUDIT.md` | historical_audit | Keep as historical audit. |
| `docs/audits/LOG_RETENTION_INDEX_STRATEGY.md` | historical_audit | Keep as historical strategy. |
| `docs/audits/MENU_OVERLAP_AUDIT_AR.md` | historical_audit | Keep as historical audit. |
| `docs/audits/ONE_TIME_ORDER_IMPLEMENTATION_PLAN_REVISED.md` | merge_candidate | Extract unique final decisions into active one-time docs, then mark historical or delete later. |
| `docs/audits/ORDER_DATE_QUERY_STRATEGY.md` | historical_audit | Keep as historical strategy. |
| `docs/audits/PAYMENT_ORDER_IDEMPOTENCY_AUDIT.md` | historical_audit | Keep as historical audit. |
| `docs/audits/PHASE_2_3A_PAGINATION_IMPLEMENTATION.md` | historical_audit | Keep as historical implementation report. |
| `docs/audits/PRODUCTION_DEPLOYMENT_CHECKLIST.md` | merge_candidate | Merge current gates into backend release/production docs, then mark historical. |
| `docs/audits/REPORT.MD` | merge_candidate | Rename or merge into production readiness history; generic name needs human review. |
| `docs/audits/SHARED_MENU_IDENTITY_MAPPING_DESIGN_AR.md` | historical_audit | Keep as historical design reference. |
| `docs/audits/SHARED_MENU_IDENTITY_PHASE1_REPORT_AR.md` | historical_audit | Keep as historical phase report. |
| `docs/audits/SHARED_MENU_IDENTITY_PHASE2_REPORT_AR.md` | historical_audit | Keep as historical phase report. |
| `docs/audits/SHARED_MENU_IDENTITY_PHASE3_REPORT_AR.md` | historical_audit | Keep as historical phase report. |
| `docs/audits/SHARED_MENU_IDENTITY_PHASE4_REPORT_AR.md` | historical_audit | Keep as historical phase report. |
| `docs/audits/WEEKLY_CUSTOM_MENU_DASHBOARD_AUDIT_AR.md` | historical_audit | Keep as historical audit. |
| `docs/audits/backend-architecture-map.mmd` | historical_audit | Keep as historical diagram. |

## Specific Overlap Findings

### One-Time Orders

Files reviewed:

- `docs/frontend-handoff/frontend-dashboard-ops-readme.md`
- `docs/one-time-orders/ONE_TIME_ORDER_DASHBOARD_OPS_FLOW.md`
- `docs/audits/ONE_TIME_ORDER_IMPLEMENTATION_PLAN_REVISED.md`

Overlap:

- All three discuss one-time order lifecycle/status transitions.
- Both frontend handoff and dashboard ops flow describe dashboard order lists, details, prepare, ready for pickup, fulfill, cancel, queue behavior, and operational errors.
- The implementation plan contains the broadest historical material: mobile contract, schema, indexes, architecture decisions, implementation phases, file-change plans, tests, and endpoint summary.

Recommendation:

- Keep `frontend-handoff/frontend-dashboard-ops-readme.md` as the dashboard frontend source of truth.
- Keep `one-time-orders/ONE_TIME_ORDER_DASHBOARD_OPS_FLOW.md` as a detailed active backend/frontend reference for one-time order operations and menu management.
- Treat `audits/ONE_TIME_ORDER_IMPLEMENTATION_PLAN_REVISED.md` as a merge candidate: extract any still-current architecture decisions, endpoint caveats, or data-model notes into active one-time docs, then mark it historical or delete later.

### Dashboard API Docs

Files reviewed:

- `docs/dashboard-api/DASHBOARD_API_GUIDE.md`
- `docs/dashboard-api/DASHBOARD_API_README_AR.md`
- `docs/dashboard-api/DASHBOARD_FRONTEND_INTEGRATION_GUIDE_AR.md`
- `docs/dashboard-api/endpoint-matrix.md`
- `docs/dashboard-api/openapi.dashboard.json`

Overlap:

- `openapi.dashboard.json` and `endpoint-matrix.md` cover the same endpoint universe; matrix is useful as a compact human table.
- `DASHBOARD_API_GUIDE.md` is intentionally concise and complements the OpenAPI contract.
- `DASHBOARD_API_README_AR.md` is a large Arabic operational/API guide with detailed menu-management and one-time-order sections, so it overlaps both dashboard API docs and one-time-order docs.
- `DASHBOARD_FRONTEND_INTEGRATION_GUIDE_AR.md` overlaps the matrix and OpenAPI for screen-to-endpoint mapping.

Risk:

- `DASHBOARD_FRONTEND_INTEGRATION_GUIDE_AR.md` says to use `/api/dashboard/meal-planner/*` and avoid `/api/admin/meal-planner-menu/*`, but `openapi.dashboard.json`, `endpoint-matrix.md`, and `DASHBOARD_API_GUIDE.md` document `/api/admin/meal-planner-menu/*` as the dashboard meal planner catalog route namespace. This needs human/backend confirmation.

Recommendation:

- Keep `openapi.dashboard.json` as canonical.
- Keep `endpoint-matrix.md` as generated/reference.
- Keep `DASHBOARD_API_GUIDE.md` as concise human guide.
- Review `DASHBOARD_FRONTEND_INTEGRATION_GUIDE_AR.md` before treating it as active.
- Consider splitting `DASHBOARD_API_README_AR.md` into smaller active docs or marking it as a broad legacy/reference guide if its content is superseded.

### Production And Backend Readiness

Files reviewed:

- `docs/backend/production/PRODUCTION_READINESS_10K_AUDIT.md`
- `docs/audits/BACKEND_PRODUCTION_READINESS_AUDIT.md`
- `docs/audits/PRODUCTION_DEPLOYMENT_CHECKLIST.md`
- `docs/backend/BACKEND_RELEASE_CONFIDENCE_PLAN_AR.md`
- `docs/backend/BACKEND_QA_CHECKLIST_AR.md`

Overlap:

- The 10K audit and backend production readiness audit both cover performance, security, race conditions, indexes, test gaps, and prioritized production fixes.
- `PRODUCTION_DEPLOYMENT_CHECKLIST.md` overlaps with release confidence and production audit deployment checklist sections.
- `BACKEND_RELEASE_CONFIDENCE_PLAN_AR.md` and `BACKEND_QA_CHECKLIST_AR.md` are operational checklists and should remain separate because one is a release process and the other is QA coverage.

Recommendation:

- Keep `backend/production/PRODUCTION_READINESS_10K_AUDIT.md` as the main production readiness reference.
- Merge any still-current findings from `audits/BACKEND_PRODUCTION_READINESS_AUDIT.md` into the 10K audit, then mark the audit historical.
- Merge current deployment gates from `audits/PRODUCTION_DEPLOYMENT_CHECKLIST.md` into `BACKEND_RELEASE_CONFIDENCE_PLAN_AR.md` or the 10K audit, then mark the checklist historical.
- Keep `BACKEND_QA_CHECKLIST_AR.md` and `BACKEND_RELEASE_CONFIDENCE_PLAN_AR.md` separate.

### Product Flow Docs

Files reviewed:

- `docs/product-flows/pickup-multi-request-backend-contract.md`
- `docs/product-flows/pickup-multi-request-frontend-contract.md`
- `docs/product-flows/unified-selection-payment-flow.md`
- `docs/product-flows/frontend-subscription-addons.md`
- `docs/product-flows/vat-inclusive-subscription-pricing.md`

Overlap:

- Pickup backend and frontend contracts intentionally cover the same flow from different perspectives.
- `frontend-subscription-addons.md` overlaps lightly with `unified-selection-payment-flow.md` around add-on payment verification, but the latter is much narrower and troubleshooting-oriented.
- VAT pricing is distinct and should stay separate.

Recommendation:

- Keep all product-flow docs separate.
- Add cross-links later from `frontend-subscription-addons.md` to `unified-selection-payment-flow.md` and `vat-inclusive-subscription-pricing.md`.

## Files Safe To Delete If Exact Duplicates

None found in this pass.

## Files That Should Be Merged

| File | Merge Into | Recommendation |
| --- | --- | --- |
| `docs/audits/ONE_TIME_ORDER_IMPLEMENTATION_PLAN_REVISED.md` | `docs/one-time-orders/ONE_TIME_ORDER_DASHBOARD_OPS_FLOW.md`, `docs/one-time-orders/ONE_TIME_ORDER_MOBILE_FLOW.md`, or `docs/one-time-orders/one-time-menu-catalog.md` | Extract unique final decisions, then mark historical or delete later. |
| `docs/dashboard-api/DASHBOARD_API_README_AR.md` | Smaller focused dashboard API/menu docs | Split or keep as broad legacy Arabic reference after review. |
| `docs/one-time-orders/ui_backend_alignment_report.md` | `docs/one-time-orders/one-time-menu-catalog.md` | Extract current UI/catalog rules if still valid. |
| `docs/audits/BACKEND_PRODUCTION_READINESS_AUDIT.md` | `docs/backend/production/PRODUCTION_READINESS_10K_AUDIT.md` | Merge still-current findings, then mark historical. |
| `docs/audits/PRODUCTION_DEPLOYMENT_CHECKLIST.md` | `docs/backend/BACKEND_RELEASE_CONFIDENCE_PLAN_AR.md` or `docs/backend/production/PRODUCTION_READINESS_10K_AUDIT.md` | Merge current deployment gates, then mark historical. |
| `docs/audits/REPORT.MD` | `docs/backend/production/PRODUCTION_READINESS_10K_AUDIT.md` or audits index | Rename or merge because the filename is non-descriptive. |

## Files That Should Remain Separate

| File | Reason |
| --- | --- |
| `docs/frontend-handoff/frontend-dashboard-ops-readme.md` | Frontend source of truth for dashboard operations. |
| `docs/frontend-handoff/frontend-accounting-report-readme.md` | Separate accounting report implementation guide. |
| `docs/dashboard-api/openapi.dashboard.json` | Machine-readable API contract. |
| `docs/dashboard-api/endpoint-matrix.md` | Compact endpoint table. |
| `docs/dashboard-api/postman.dashboard_collection.json` | Compact Postman collection. |
| `docs/dashboard-api/postman.dashboard_full_collection.json` | Full QA/onboarding collection. |
| `docs/backend/BACKEND_QA_CHECKLIST_AR.md` | QA checklist has a distinct operational purpose. |
| `docs/backend/BACKEND_RELEASE_CONFIDENCE_PLAN_AR.md` | Release process has a distinct operational purpose. |
| `docs/product-flows/pickup-multi-request-backend-contract.md` | Backend-owned pickup request contract. |
| `docs/product-flows/pickup-multi-request-frontend-contract.md` | Frontend-owned pickup request contract. |
| `docs/product-flows/unified-selection-payment-flow.md` | Focused troubleshooting/reference doc. |
| `docs/product-flows/frontend-subscription-addons.md` | Focused frontend addon integration doc. |
| `docs/product-flows/vat-inclusive-subscription-pricing.md` | Focused pricing reference. |
| `docs/meal-planner/MEAL_PLANNER_CANONICAL_CONTRACT.md` | Canonical meal planner contract. |
| `docs/meal-planner/MEAL_PLANNER_TEST_COVERAGE.md` | Test coverage reference. |

## Historical/Audit Docs

These should remain available for context, but should not be treated as current frontend implementation source of truth:

- `docs/audits/BACKEND_ARCHITECTURE_BLUEPRINT_AR.md`
- `docs/audits/BACKEND_PHASE_2_PERFORMANCE_PLAN.md`
- `docs/audits/BACKEND_PRODUCTION_READINESS_AUDIT.md`
- `docs/audits/CUSTOM_PREMIUM_SALAD_CONTRACT_AUDIT.md`
- `docs/audits/DASHBOARD_PAGINATION_PLAN.md`
- `docs/audits/FLUTTER_BACKEND_GAP_ANALYSIS_REPORT.md`
- `docs/audits/FULFILLMENT_LOGIC_AUDIT.md`
- `docs/audits/LOG_RETENTION_INDEX_STRATEGY.md`
- `docs/audits/MENU_OVERLAP_AUDIT_AR.md`
- `docs/audits/ONE_TIME_ORDER_IMPLEMENTATION_PLAN_REVISED.md`
- `docs/audits/ORDER_DATE_QUERY_STRATEGY.md`
- `docs/audits/PAYMENT_ORDER_IDEMPOTENCY_AUDIT.md`
- `docs/audits/PHASE_2_3A_PAGINATION_IMPLEMENTATION.md`
- `docs/audits/PRODUCTION_DEPLOYMENT_CHECKLIST.md`
- `docs/audits/REPORT.MD`
- `docs/audits/SHARED_MENU_IDENTITY_MAPPING_DESIGN_AR.md`
- `docs/audits/SHARED_MENU_IDENTITY_PHASE1_REPORT_AR.md`
- `docs/audits/SHARED_MENU_IDENTITY_PHASE2_REPORT_AR.md`
- `docs/audits/SHARED_MENU_IDENTITY_PHASE3_REPORT_AR.md`
- `docs/audits/SHARED_MENU_IDENTITY_PHASE4_REPORT_AR.md`
- `docs/audits/WEEKLY_CUSTOM_MENU_DASHBOARD_AUDIT_AR.md`
- `docs/audits/backend-architecture-map.mmd`
- `docs/meal-planner/MEAL_PLANNER_FULLSTACK_AUDIT.md`

## Risky Files That Need Human Review

| File | Why Risky | Suggested Decision |
| --- | --- | --- |
| `docs/dashboard-api/DASHBOARD_FRONTEND_INTEGRATION_GUIDE_AR.md` | Route guidance for meal-planner dashboard APIs appears to conflict with OpenAPI/current dashboard guide. | Confirm current backend route namespace, then update or mark deprecated. |
| `docs/audits/FRONTEND_FLUTTER_REMOVAL_REPORT.md` | File claims to be final Flutter source of truth but lives under audits. | If current, relocate to an active Flutter/mobile docs area; otherwise mark historical. |
| `docs/audits/REPORT.MD` | Generic filename and broad 10K production summary overlap production readiness docs. | Rename to descriptive historical filename or merge useful content into production docs. |

## Recommended Cleanup Plan

1. Validate `DASHBOARD_FRONTEND_INTEGRATION_GUIDE_AR.md` against backend routes and `openapi.dashboard.json`.
2. Decide whether `FRONTEND_FLUTTER_REMOVAL_REPORT.md` is still current. If yes, move it out of `audits/` in a later pass; if no, add a historical/deprecated status note.
3. Extract unique one-time-order final decisions from `audits/ONE_TIME_ORDER_IMPLEMENTATION_PLAN_REVISED.md` into active one-time docs.
4. Extract current UI/catalog rules from `one-time-orders/ui_backend_alignment_report.md` into `one-time-menu-catalog.md` if they are still valid.
5. Merge still-current production readiness findings from `audits/BACKEND_PRODUCTION_READINESS_AUDIT.md` and `audits/REPORT.MD` into `backend/production/PRODUCTION_READINESS_10K_AUDIT.md`.
6. Merge deployment gates from `audits/PRODUCTION_DEPLOYMENT_CHECKLIST.md` into `BACKEND_RELEASE_CONFIDENCE_PLAN_AR.md` or the production readiness doc.
7. Add status banners to files that remain in `audits/` but could be mistaken for current implementation guidance.
8. Only after the merge pass, consider deleting historical merge-source files that have no remaining unique value.

## Summary Counts

| Metric | Count |
| --- | ---: |
| Docs reviewed before this report | 58 |
| Exact duplicate files | 0 |
| Merge candidates | 6 |
| Files recommended for later deletion after merge/review | 2 |
| Files recommended for historical/deprecated marking | 6 |

Files recommended for later deletion after merge/review:

- `docs/audits/ONE_TIME_ORDER_IMPLEMENTATION_PLAN_REVISED.md`
- `docs/audits/REPORT.MD`

Files recommended for historical/deprecated marking:

- `docs/audits/ONE_TIME_ORDER_IMPLEMENTATION_PLAN_REVISED.md`
- `docs/audits/BACKEND_PRODUCTION_READINESS_AUDIT.md`
- `docs/audits/PRODUCTION_DEPLOYMENT_CHECKLIST.md`
- `docs/audits/FLUTTER_BACKEND_GAP_ANALYSIS_REPORT.md`
- `docs/audits/REPORT.MD`
- `docs/audits/FRONTEND_FLUTTER_REMOVAL_REPORT.md`, unless it is relocated as an active Flutter source-of-truth doc.
