# POS G1 — owner decisions (2026-11-08)

These decisions follow D-092. D-087 through D-092 are unchanged.

- **D-093** — Versioned daily closing: `LEGACY_V1` uses `calculateClosing`; `POS_V2` uses `expectedTotals`. `posClosingStartDate` is effective-dated and audited. Missing setting means all days LEGACY. A saved closing without `closingVersion` remains LEGACY without migration; new closing versions freeze at creation. Staging-only intended date: 2026-11-08; no DB mutation by committing code.
- **D-094** — In POS_V2, restaurant/HungerStation/Keeta totals are sourced only from POS. Manual amounts for those channels are rejected with `400 MANUAL_CHANNEL_RECORDED_IN_POS`. Only `channels.other` with name, reference and integer halala amount is accepted, separately as app receivable.
- **D-095** — POS_V2 reason required exclusively for nonzero cash difference, nonzero network difference, submitted subscription count difference, nonzero unknown subscription amount, positive reviewPaymentsCount, or subscription refunds. Legacy checks do not apply to POS_V2. Only admin/superadmin approve or return; cashier/restaurant remain identical operational roles.
- **D-096 (owner operational decision, pending safeguards)** — Owner authorized a full Production copy to Staging on 2026-11-08. This is a record of a decision, NOT authorization in this G1 task to copy or access PII. Outstanding security gates: restrict Staging access, prove Moyasar and Twilio keys on Staging are test-only, determine retention, remove Production-link temporary jobs. No personal data or credentials belong in this document.

No code here initiates a Production export or database write by default.
