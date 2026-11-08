# POS G1 — Owner decisions D-093 through D-096 (2026-11-08)

**Status:** Approved by owner for implementation as Draft PRs on Staging branches only. No merge, deployment, Production or main changes authorised. D-087 through D-092 unchanged.

## D-093 — Fixed version of daily cash closing
- \`LEGACY_V1\`: existing \`calculateClosing\`; missing \`closingVersion\` on a persisted document is always legacy, without writes on read.
- \`POS_V2\`: server-owned POS \`expectedTotals\` + reconciliation.
- The version is frozen at the first create. Configuration key \`posClosingStartDate\`, versioned by \`effectiveFrom\` with audit like \`businessDayCutoff\`: before the start date legacy; from the start POS.
- Missing setting means all new closings are \`LEGACY_V1\`; Production fail-safe.
- Isolated Staging seed is pinned to 2026-11-08, guarded by \`isPosStagingRuntime\`, rs0 and exact Staging DB. Seed is NOT run by this PR.

## D-094 — POS_V2 channel ownership
- Restaurant, HungerStation and Keeta totals come only from POS; manual nonzero writes to these three channels return HTTP 400 \`MANUAL_CHANNEL_RECORDED_IN_POS\`.
- Only \`channels.other\` remains manual: name, external reference, integer halalas. It is app receivable, never cash or network.
- No manual channel may double count a channel or external reference already attributed to POS.

## D-095 — Server-authoritative discrepancy reason
For POS_V2, a reason is required precisely for any of:
\`cashDifferenceHalala\`, \`networkDifferenceHalala\`, provided subscription count difference, \`unknownSubscriptionHalala\`, \`reviewPaymentsCount\` or subscription refunds.
Legacy-only \`localDifferenceHalala\`/\`overallDifferenceHalala\` checks must NOT apply to POS_V2.
Backend provides \`requiresReason\` and \`reasonCodes\`; admin-only approve/return unchanged.

## D-096 — Owner-approved Production copy on Staging (unresolved protection gate)
Owner reports a full Production copy was permitted for Staging on 2026-11-08. This records the instruction, **not** independent verification of copy execution, sanitization or access controls. Security review remains **OPEN** pending:
1. Restrict Staging data access and review connected clients/operators.
2. Prove Moyasar and Twilio keys on Staging are test-only (never print tokens).
3. Approve retention and secure deletion schedule for any Production-derived data.
4. Reconcile previous synthetic-only runbook restrictions separately; no new copy or PII export is authorised by this Draft PR.

No customer records, personal information, secrets, credentials or tokens belong in these files.
