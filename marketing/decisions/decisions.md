# Marketing Decision Log

Record material decisions so future sessions understand not just *what* was chosen, but *why*.

## DEC-001 — First-paid subscribers are the North Star

**Date:** 2026-10-07  
**Status:** Active

**Decision:** Optimize marketing primarily around first-time paid subscribers, followed by retention/repeat and profitable revenue.

**Reason:** Followers, likes and views can be useful diagnostics but do not represent the primary business outcome.

---

## DEC-002 — Do not make Basic Diet a discount-led brand

**Date:** 2026-10-07  
**Status:** Active

**Decision:** Promotional codes should be used as conversion tools and should not dominate organic content.

**Reason:** Brand demand should be built around taste, choice, convenience and verified product value rather than training customers to wait for discounts.

---

## DEC-003 — Marketing work uses a persistent repository source of truth

**Date:** 2026-10-07  
**Status:** Active

**Decision:** Store durable marketing context, decisions, experiments, snapshots and learnings under `marketing/` and the operational agent workflow under `skills/basic-diet-marketing/`.

**Reason:** New chats/agents must continue from existing work instead of rebuilding context from conversation history.

---

## DEC-004 — Live metrics remain live-source data

**Date:** 2026-10-07  
**Status:** Active

**Decision:** The backend/database/dashboard remains authoritative for current metrics. GitHub stores dated aggregate snapshots only when metrics are used for historical decisions.

**Reason:** Prevent stale repository numbers from being confused with current production data.

---

## DEC-005 — Ground marketing creative in real inputs

**Date:** 2026-10-07  
**Status:** Active

**Decision:** Content/ad concepts should cite a real product fact, asset, customer insight, prior performance result, offer, or business metric.

**Reason:** Reduce generic AI marketing and prevent fabricated claims.

---

## DEC-006 — Repository marketing docs stay outside runtime code

**Date:** 2026-10-07  
**Status:** Active

**Decision:** Marketing OS documentation and skills remain outside `src/`. Runtime code changes happen only when a marketing requirement genuinely requires implementation.

**Reason:** Preserve production safety and separate strategy/state from application behavior.
