# Dashboard baseline failures — 2026-10-31

Reproduced before retention changes at dashboard base `1de7b3ff9fb4240ef9382625f9f4c346c111b656`, with the same lockfile and `vitest run --maxWorkers=2`. Base: **44 failed / 311 passed**, 16 failing files and one empty suite. Candidate before new UI tests: **44 failed / 315 passed**. The four extra passing assertions are the historical retention snapshot tests. No failed test was removed, skipped, weakened or marked expected-to-fail.

These are release blockers under the requested full-regression/lint gate. They are outside the retention changes and remain open. Updating legacy UI fixtures requires checking the current authoring/operations contract; changing subscription creation defaults or authorization fallbacks just to satisfy old expectations would be unsafe.

| Failing file | Assertions | Root cause observed | Classification / follow-up |
|---|---:|---|---|
| subscriptionCreationContract.test.ts | 22 | Fixture omits now-required `subscriptionMode`; Zod rejects before delivery/payment assertions | Stale fixture; add explicit mode and revalidate the business assertions |
| subscriptionPromoCodeContract.test.ts | 3 | Two fixtures omit mode; one asserts an old literal explanatory string | Stale fixture/text assertion; validate current displayed pricing semantics |
| mealPlannerAuthoritativeOptionGroups.test.tsx | 4 | Old builder-group schema/props; `menuGroups` undefined; dialog lacks QueryClientProvider | Stale harness and authoring contract |
| mealPlannerV2Components.test.tsx | 4 | Dialog now reads catalog through React Query; missing provider | Stale harness, requires authoritative catalog fixture |
| mealPlannerV2RequiredFields.test.tsx | 1 | Same missing provider | Stale harness |
| mealPlannerV2ApiContract.test.ts | 1 | Expects generic options endpoint; implementation uses family-specific picker with different parameters | Contract drift; resolve against deployed backend before updating |
| mealPlannerOptionGroupFlow.test.ts | 1 | Expects foreign-family rows removed; implementation retains a disabled conflicting row | Behavior/expectation drift; preserve backend eligibility rules |
| mealPlannerMenuOptionSelectionFallback.test.ts | 1 | Same option IDs in a different order | Ordering expectation drift |
| mealPlannerMenuProductFlow.test.ts | 0 | No Vitest suite registered | Test-runner incompatibility / empty suite |
| accountingReportUi.test.tsx | 1 | Expects old Arabic KPI label | UI/expectation drift; review current accounting metric name |
| adminCustomerCredentialsFlow.test.tsx | 1 | Asserts dialog closes immediately; callback not called at assertion time | Async/dialog expectation; verify pending/completion behavior |
| adminCustomerErrorMessages.test.ts | 1 | Supposedly valid Saudi phone fixture fails schema | Code/validation mismatch; customer-create contract needs investigation |
| createUserSaudiPhone.test.ts | 1 | Local nine-digit phone rejected despite normalization expectation | Code/validation mismatch; do not relax validation without contract check |
| deliveryOperationsFilters.test.ts | 1 | Combined Arabic district/building query not matched | Search behavior defect or changed tokenization contract |
| fetchCourierDeliveries.test.ts | 1 | Empty `allowedActions` yields synthesized courier actions instead of none | Authorization presentation mismatch; verify backend authorization separately |
| subscriptionStackingPresentation.test.ts | 1 | Manual deduction is now denied for incomplete legacy fixture | Capability/fixture drift; do not broaden deduction eligibility to turn test green |

Assertions sum to 44. The empty-suite error is additional to that assertion count.

## Lint

Base and candidate both report **32 errors + 10 warnings** using unchanged ESLint rules. None are suppressed by this work. Retention files, the customer-management route and the changed auth hook pass the scoped lint command.

| Rule/category | Existing affected areas |
|---|---|
| `react-hooks/set-state-in-effect` | Candidate picker; seven subscription tracking implementations; cancel/refund/invoice dialogs; daily closing; subscription audit |
| `react-hooks/refs` | Customer-create form, three accesses |
| `react-refresh/only-export-components` | Meal planner card dialog and premium meal section |
| `@typescript-eslint/no-explicit-any` | Authoring contexts (five) and landing conversion test |
| `no-useless-escape` | Delivery search patterns (two) |
| `@typescript-eslint/no-unused-vars` | Subscription payload payment destructuring, dashboard users roles, subscription test payment method |
| `react-hooks/exhaustive-deps` warnings | Existing catalog/picker, tracking, operations, subscription creation and audit dependencies |

The new `Retention final QA` workflow runs the full suite and full lint in independent jobs so both existing problems stay visible. They are not treated as infrastructure failures and are not bypassed.
