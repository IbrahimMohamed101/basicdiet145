تمام — دي النسخة النهائية **جاهزة للتسليم للعميل** بصياغة احترافية، مرتبة، واضحة، ومتكاملة (Product-level Document):

---

# 🧾 Subscription-Based Meal Delivery System

## 📌 Final Product Specification & User Story

---

## 🧠 Executive Summary

This system provides a fully managed meal subscription lifecycle that enables customers to:

* Subscribe to structured meal plans
* Select and customize daily meals
* Pause (freeze) or skip specific days
* Receive meals via delivery or pickup
* Track order status from planning to fulfillment

The system enforces strict operational rules such as:

* Daily cutoff time for locking orders
* No modifications after cutoff
* Immediate cancellation behavior
* Plan-based limits for skipping and freezing
* Clear separation between delivery and pickup flows

---

# 👤 Primary User Story

**As a** customer,
**I want to** subscribe to a meal plan and manage my daily meal schedule,
**So that** I can receive meals automatically with full flexibility and control.

---

# 👥 System Actors

| Actor         | Responsibility                                      |
| ------------- | --------------------------------------------------- |
| Customer      | Manage subscription, select meals, skip/freeze days |
| Kitchen Staff | Prepare meals after cutoff                          |
| Courier       | Deliver orders                                      |
| Branch Staff  | Handle pickup verification                          |
| System        | Automate cutoff, locking, and validations           |

---

# 🔄 Subscription Lifecycle Overview

## 1) Subscription Creation (Checkout)

### Behavior

* User selects a plan
* System creates:

  * CheckoutDraft
  * Payment record
* After successful payment:

  * Subscription is created with status = `active`
* Before payment:

  * No active subscription exists in the system

---

## 2) Daily Meal Planning

### Behavior

* User can:

  * Select meals
  * Update selections
  * Confirm selections
* Day status = `open`
* Validation:

  * Only checks meal count (not calories or categories)

---

## 3) Cutoff & Auto Lock

### Behavior

* System automatically locks next-day orders at cutoff time (KSA timezone)
* Status transition:

```text
open → locked
```

### Rules

* No modifications allowed after cutoff
* If no meals selected:

  * Day is locked
  * Meals are still deducted
  * No fallback meals are added

---

## 4) Kitchen Flow

```text
locked → in_preparation → out_for_delivery
```

* Kitchen processes locked orders
* Orders move to preparation phase
* Then ready for dispatch

---

## 5) Delivery Flow

```text
out_for_delivery → fulfilled
```

* Courier marks delivery as completed
* System records:

  * `fulfilledAt`

---

## 6) Pickup Flow

```text
locked → in_preparation → ready_for_pickup → fulfilled
```

### Behavior

* User selects pickup mode
* Branch prepares order
* User provides pickup code
* Branch verifies and completes order

---

# ⚙️ Subscription Management

## Freeze (Pause Subscription)

### Behavior

* User can freeze:

  * Existing days
  * Future days
* Status = `frozen`
* Can be reversed via unfreeze

### Constraints

* Limited by:

  * `maxDays`
  * `maxTimes`

---

## Skip Day

### Behavior

* Allowed only if day = `open`
* Status = `skipped`
* No meal deduction
* Subscription duration is extended

---

## Cancel Subscription

### Behavior

* Immediate cancellation
* Status = `canceled`
* All future days removed
* Ongoing orders continue

---

## Renewal

### Behavior

* Creates a completely new subscription
* Copies configuration from previous subscription
* Linked via `renewedFromSubscriptionId`
* Does NOT continue remaining days

---

## Expiry

### Behavior

* Triggered by:

  * End date OR insufficient remaining meals
* No new operations allowed
* Requests are rejected

---

# 🔒 Business Rules & Constraints

## Cutoff Rule

* Global cutoff time (default: 00:00 KSA)
* Cannot be configured per plan

---

## Selection Rules

* Editable only while day = `open`
* Confirmation does NOT lock the day

---

## Empty Day Rule

* No selections → still locked
* Meals deducted
* No auto-assignment

---

## Freeze vs Skip

* Cannot transition directly between:

  * `frozen` ↔ `skipped`
* Both require starting from `open`

---

## Cancellation Rule

* Immediate effect
* Future days deleted
* Committed days continue

---

## Expired Rule

* All actions blocked
* Returns error responses

---

## Plan Limits

* Skip limit (`maxDays`)
* Freeze limits (`maxDays`, `maxTimes`)

---

# ⚠️ Edge Cases (Terminal States)

| State              | Description                           |
| ------------------ | ------------------------------------- |
| no_show            | User did not receive or collect order |
| canceled_at_branch | Order canceled manually at branch     |
| delivery_canceled  | Delivery failed                       |

### Behavior

* Final states (no retry logic)
* System updates silently

---

# 🔄 Subscription Day State Machine

## Main Flow

```text
open → locked → in_preparation → out_for_delivery → fulfilled
```

## Pickup Flow

```text
open → locked → in_preparation → ready_for_pickup → fulfilled
```

## Alternative States

```text
open → skipped
open → frozen
out_for_delivery → no_show
ready_for_pickup → canceled_at_branch
```

---

# 📊 Subscription Day State Diagram

> The following diagram represents the full lifecycle of a subscription day:

(Attach diagram provided)

---

# ⚠️ System Limitations

* No automatic retry for failed deliveries
* No fallback meals for empty days
* Meal validation does NOT consider calories or categories
* Cutoff is global (not per plan)
* No full subscription pause (freeze works per day only)

---

# 🎯 Business Value

* Eliminates daily ordering effort
* Provides flexible scheduling (skip / freeze)
* Enables clear operational workflow
* Reduces delivery errors
* Improves customer retention and experience

---

# ✅ Acceptance Summary

The system guarantees:

* Full lifecycle management from subscription to fulfillment
* Day-level control (not full subscription pause)
* Strict enforcement of cutoff and operational rules
* Accurate tracking of meal consumption and delivery
* Clear separation between delivery and pickup flows

---

# 🧠 Final Note

This document reflects:

* Actual system behavior (based on implementation)
* Business rules enforced at runtime
* Operational workflows for all actors

👉 It can be used as:

* Product specification
* Client agreement reference
* QA baseline
* Backend implementation contract

---

🔥 كده أنت فعليًا جاهز تسلّم
ولو عايز أحوّلها لك PDF رسمي أو presentation للعميل — أعملهالك فورًا 👌
