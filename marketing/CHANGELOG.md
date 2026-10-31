# Marketing OS Changelog

## 2026-10-31 — Retention release QA

Executed isolated full-stack retention QA, fixed eligibility/payment evidence, opt-out policy, cross-origin reads, stale customer cache and duplicate form submission; added regression tests and auditable CI gates. Published [final QA report](../RETENTION_DASHBOARD_FINAL_QA_REPORT.md), synthetic browser evidence and baseline failure inventory. Decision NOT READY: full dashboard regression/lint fail and staging isolation/versions remain unverified. No production write, outreach, merge or deployment.

## 2026-10-07 — v2

Completed the first external data-gathering pass for content readiness.

Added:
- public Basic Diet VOC findings,
- competitor/market profile,
- public app/store and restaurant listing signals,
- 30-item grounded daily content backlog,
- explicit baseline status,
- updated project state from "foundation building" to "daily organic content ready."

Important:
The live 30/60/90 Marketing Analytics baseline is still not stored as a repository snapshot because the production endpoint requires authenticated admin access and current credentials are intentionally not copied into repository documentation.

## 2026-10-07 — v1

Created the repository-based Basic Diet Marketing OS.

Added:
- persistent current state,
- product marketing context,
- positioning and messaging,
- offer/pricing context,
- audience/VOC framework,
- data-source map,
- analytics measurement framework,
- documentation of implemented Marketing Analytics,
- content strategy and asset catalog,
- content and winner logs,
- experiment log,
- decision log,
- current execution plan,
- Basic Diet marketing agent skill,
- repository agent bootstrap protocol.

Reason:
Marketing strategy and execution should continue across new chats/agents without depending on conversation memory.


## 2026-10-28 — Website registration offer published to production

Published backend #174, dashboard client_dashbourd#61 and website #175 in a coordinated production rollout after explicit user approval. All three Railway releases reached SUCCESS. Verified the public home/menu/catalog, the direct 15% registration dialog, real package savings, and trusted no-plan intake without storing synthetic customer data. See STATE.md for deployment IDs and verification limits.

Begin measuring saved unique inquiries and their verified paid-subscription outcomes; no marketing lift or paid-ad launch is claimed.
