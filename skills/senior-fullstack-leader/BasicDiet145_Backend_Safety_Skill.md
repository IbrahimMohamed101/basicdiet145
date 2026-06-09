---
name: BasicDiet145 Backend Safety & Verification
description: Use this skill to audit, protect, and verify the BasicDiet145 backend before Flutter/Dashboard integration or release. Prevents silent breakage across one-time orders, subscription meal planner, meal builder v3, add-ons, quote, checkout, VAT, and MongoDB data integrity. Enforces safety rules (no production mutations, no unauthorized price changes, no unsafe deployments), validates API contracts and data shapes, audits pricing invariants and VAT logic, and verifies complete E2E customer cycles. Generates audit checklists, test plans, failure analysis, and Codex-ready implementation instructions. Use whenever verifying backend safety, auditing integrations, validating data integrity, checking API compatibility, or preparing for customer-facing releases.
compatibility: Requires Codex access, MongoDB inspection tools, API testing capability, Git commit inspection
---

# BasicDiet145 Backend Safety & Verification Skill

This skill provides a comprehensive framework for auditing and protecting the BasicDiet145 backend ecosystem before customer-facing integrations and releases. It focuses on preventing silent failures, data corruption, and pricing inconsistencies that could impact subscribers, orders, and platform reliability.

## Core Safety Rules (Non-Negotiable)

These rules are enforced across all audit and verification workflows:

1. **Never run production seed/sync/reset/bootstrap** — Use staging databases only
2. **Never manually mutate MongoDB** — All data changes must go through verified API endpoints
3. **Never change prices or VAT logic** — Requires approval from finance + backend leads
4. **Never deploy/commit/push without approval** — All changes require review before production

## Critical Systems & Audit Scope

### Primary Systems
- **One-Time Orders** — API contract, price calculation, inventory sync
- **Subscription Meal Planner** — Recurring scheduling, pause/resume logic, billing cycles
- **Meal Builder v3** — Response shape, ingredient availability, constraints validation
- **Add-ons System** — Exposure rules, pricing composition, subscription compatibility
- **Quote Module** — Calculation accuracy, discount application, expiration handling
- **Checkout Flow** — Cart validation, payment integration, confirmation sequences
- **VAT Handling** — Inclusive/exclusive calculation, regional rules, invoice accuracy
- **MongoDB Data** — Document schema consistency, referential integrity, index health

### Integration Touch Points
- Flutter Mobile App
- Web Dashboard
- Third-party payment processors
- Analytics & reporting systems

---

## Audit Workflows

### 1. Pre-Integration Audit Checklist

**Use this before connecting Flutter or Dashboard to backend.**

```
API CONTRACT VALIDATION
☐ All endpoints respond with documented schema
☐ HTTP status codes match specification
☐ Error payloads include error_code + human_readable_message
☐ Pagination (if present) implements cursor or offset correctly
☐ Timestamp formats are ISO 8601 UTC
☐ Required fields are never null; optional fields use explicit null or absence
☐ Enum values are locked (no runtime surprises)

MEAL BUILDER V3 SPECIFIC
☐ GET /meal-builder/templates returns complete ingredient list with IDs
☐ POST /meal-builder/customize validates ingredient availability in real-time
☐ Response shape includes: { id, name, calories, macros, allergens, cost, availability }
☐ Allergen array is never null (empty array if none)
☐ Availability flag correctly reflects inventory status
☐ Cost reflects current pricing (no cached stale prices)

CATALOG & AVAILABILITY
☐ CatalogItem references (meal IDs, add-on IDs) resolve to active documents
☐ Availability field matches inventory management source-of-truth
☐ Discontinued items return 404 or have explicit unavailable flag
☐ Price field matches MongoDB price field (no drift)

ADD-ON EXPOSURE RULES
☐ One-time order add-ons don't expose subscription-only items
☐ Subscription add-ons list correct subscription-compatible meals
☐ Add-on pricing calculation: base_price × quantity (no hidden multipliers)
☐ Add-on maximum constraints enforced at API level
☐ Allergen warnings surface for all exposed add-ons

PRICING INVARIANTS
☐ Single-order price ≥ $minimum_order_value
☐ Subscription weekly price ≥ $minimum_subscription_value
☐ Discount application never results in negative prices
☐ Tax calculation: (subtotal × tax_rate).round(2) = final_tax
☐ Currency consistency: all prices in stored base currency (GBP/USD/EGP)

VAT LOGIC AUDIT
☐ VAT inclusive pricing: display_price = calc_price × (1 + vat_rate)
☐ VAT exclusive pricing: display_price = calc_price (vat added at checkout)
☐ Regional VAT rules: correct rate applied by delivery postcode/region
☐ Invoice VAT line item matches calculation: (subtotal × vat_rate).round(2)
☐ Reverse charge rules (B2B) correctly identified in quotes

MONGODB INTEGRITY
☐ All foreign keys (Order.meal_ids, Subscription.meal_ids) resolve
☐ No orphaned documents (subscriptions without valid users)
☐ Indexes exist on query fields: { userId, createdAt }, { meal_id }, { status }
☐ Document schema version matches current backend version
☐ No null values in required fields (should use explicit defaults)
```

### 2. E2E Customer Cycle Validation

**Run this to verify complete workflows work end-to-end.**

#### Workflow A: One-Time Order
```
1. User searches for meals → GET /meals?filters=... 
   ✓ Verify: Returns available CatalogItems, prices match MongoDB
   
2. User selects 3 meals + 2 add-ons → Build cart object
   ✓ Verify: Cart schema matches POST /orders/quote payload spec
   
3. Request quote → POST /orders/quote { meals: [...], add_ons: [...] }
   ✓ Verify: Returns { subtotal, tax, total, expiry_timestamp }
   ✓ Verify: Tax calculation = subtotal × vat_rate
   ✓ Verify: Quote expires in 15 minutes (timestamp validation)
   
4. Request checkout → POST /orders/create { quote_id, payment_token }
   ✓ Verify: Payment processor confirms charge
   ✓ Verify: Order created with status=pending_confirmation
   ✓ Verify: Order ID matches payment_metadata.order_id
   
5. Receive confirmation email
   ✓ Verify: Email contains correct totals
   ✓ Verify: Order items match submitted cart
   
6. Delivery fulfillment
   ✓ Verify: Status progression: pending → confirmed → preparing → out_for_delivery → delivered
   ✓ Verify: Inventory deducted when status=confirmed
```

#### Workflow B: Subscription Setup
```
1. User selects subscription + 4 meals → POST /subscriptions/create
   ✓ Verify: Only meal_ids from subscription-eligible catalog
   ✓ Verify: Response includes { id, next_delivery_date, recurring_price }
   
2. Recurring cycle trigger (weekly/biweekly)
   ✓ Verify: Cron job creates Order with subscription_id reference
   ✓ Verify: Price calculation uses current meal prices (not cached)
   ✓ Verify: Subscription skip/pause respects date range
   
3. Add-on selection for upcoming cycle
   ✓ Verify: Only subscription-compatible add-ons offered
   ✓ Verify: Add-on pricing composition correct: base + add_ons_total
   
4. Pause/Resume subscription
   ✓ Verify: Pause blocks next N cycles (validates date range)
   ✓ Verify: Resume unlocks billing for next delivery
   ✓ Verify: No charges during pause period
   
5. Cancellation
   ✓ Verify: Pending orders still deliver
   ✓ Verify: No future orders created
   ✓ Verify: Final invoice issued if partial period
```

#### Workflow C: VAT & Regional Pricing
```
1. User enters UK postcode → GET /shipping/regions?postcode=...
   ✓ Verify: Returns { region_code, vat_rate, shipping_cost }
   ✓ Verify: VAT rate correct for region (20% UK, 15% Abu Dhabi, etc.)
   
2. Quote calculation with VAT
   ✓ Verify: Subtotal = sum(meal_prices) + sum(add_on_prices)
   ✓ Verify: Tax = floor(subtotal × vat_rate × 100) / 100
   ✓ Verify: Total = subtotal + tax
   ✓ Verify: Invoice shows VAT inclusive/exclusive correctly
   
3. Different regions (multi-country deployment)
   ✓ Verify: UAE orders use 5% VAT
   ✓ Verify: Egypt orders use 14% VAT
   ✓ Verify: UK orders use 20% VAT
   ✓ Verify: No pricing leakage between regions
```

---

## Failure Analysis Framework

When audit findings surface issues, use this framework to document and remediate:

### Severity Levels

**CRITICAL** — Data loss risk, security vulnerability, or silent pricing/delivery failure
- Example: Subscription charges continue after cancellation
- Response: Hotfix immediately, notify affected customers

**HIGH** — Functionality broken for subset of users or incorrect data in logs
- Example: VAT calculation incorrect for 15%+ of orders
- Response: Deploy fix within sprint, backtest affected orders

**MEDIUM** — Edge case handling, UI/API contract mismatch, performance issue
- Example: Error message doesn't match spec, response takes 5s
- Response: Plan for next release, may require workaround in frontend

**LOW** — Documentation, logging, or non-critical code quality issue
- Example: Missing index slowing analytics query, unclear error message
- Response: Log for future improvement, doesn't block release

### Failure Documentation Template

```
FAILURE: [Brief title]
Severity: [CRITICAL|HIGH|MEDIUM|LOW]
System: [One-Time Orders|Subscription|Meal Builder v3|VAT|Add-ons|Other]
Root Cause: [What happened]
Data Impact: [How many orders/users affected, what fields corrupted]
Customer Impact: [What customers experienced]
Detection Method: [How we found it - audit check, customer report, error log]
Fix: [Code change required, DB migration if needed]
Verification: [How to confirm fix works]
Prevention: [Test case added, new audit rule, monitoring alert]
Backtest: [Which past orders need correction]
```

---

## Codex Implementation Instructions

Use these instructions when fixing issues discovered in audits.

### Safe Database Query Pattern

```javascript
// SAFE: Read-only, non-mutating
const orders = await db.collection('orders')
  .find({ status: 'pending' })
  .toArray();

// UNSAFE: Mutating production data without approval
await db.collection('orders').updateMany(
  { status: 'pending' },
  { $set: { price: 100 } } // ❌ Never do this
);

// SAFE: Mutation with approval + audit trail
await db.collection('order_corrections').insertOne({
  order_id: orderId,
  reason: 'Approved correction - ticket #12345',
  old_price: 120,
  new_price: 100,
  changed_by: 'backend-lead',
  timestamp: new Date()
});
// Then apply correction through API, creating audit log
```

### Safe API Validation Pattern

```javascript
// Define contract once, validate everywhere
const OrderCreateSchema = {
  meals: { type: 'array', items: 'string', required: true },
  add_ons: { type: 'array', items: 'string', required: false },
  delivery_date: { type: 'string', format: 'ISO8601', required: true },
  payment_token: { type: 'string', required: true }
};

// Validate incoming request
function validateOrderCreate(payload) {
  const validation = ajv.compile(OrderCreateSchema);
  if (!validation(payload)) {
    return { valid: false, errors: validation.errors };
  }
  return { valid: true };
}

// Use validation result
app.post('/orders/create', (req, res) => {
  const { valid, errors } = validateOrderCreate(req.body);
  if (!valid) {
    return res.status(400).json({
      error_code: 'INVALID_PAYLOAD',
      message: 'Request does not match contract',
      details: errors
    });
  }
  // Proceed with safe assumptions about req.body
});
```

### Pricing Calculation Audit

```javascript
// Centralize pricing logic, version it, test exhaustively
function calculateOrderTotal(meals, addOns, vatRate) {
  // Step 1: Validate inputs
  if (!meals || meals.length === 0) throw new Error('No meals provided');
  if (vatRate < 0 || vatRate > 1) throw new Error('Invalid VAT rate');
  
  // Step 2: Calculate subtotal
  const mealCost = meals.reduce((sum, meal) => sum + meal.price, 0);
  const addOnCost = addOns.reduce((sum, addon) => sum + addon.price, 0);
  const subtotal = mealCost + addOnCost;
  
  // Step 3: Calculate tax (round to 2 decimals)
  const tax = Math.round(subtotal * vatRate * 100) / 100;
  
  // Step 4: Validate invariants
  if (subtotal < MINIMUM_ORDER_VALUE) {
    throw new Error(`Subtotal ${subtotal} below minimum ${MINIMUM_ORDER_VALUE}`);
  }
  
  return {
    subtotal: parseFloat(subtotal.toFixed(2)),
    tax: parseFloat(tax.toFixed(2)),
    total: parseFloat((subtotal + tax).toFixed(2)),
    breakdown: { meals: mealCost, addOns: addOnCost, vat_rate: vatRate }
  };
}

// Test with exact scenarios
test('VAT calculation for UK 20%', () => {
  const result = calculateOrderTotal(
    [{ price: 50 }],
    [{ price: 10 }],
    0.20
  );
  expect(result.subtotal).toBe(60);
  expect(result.tax).toBe(12); // 60 × 0.20 = 12
  expect(result.total).toBe(72);
});
```

### Subscription Cycle Safety

```javascript
// Document exact expected behavior for each state
const SubscriptionStates = {
  ACTIVE: {
    description: 'Billing weekly/biweekly, can add/remove meals',
    next_action: 'Schedule delivery or allow modifications',
    can_pause: true,
    can_cancel: true
  },
  PAUSED: {
    description: 'No charges, no deliveries during pause period',
    next_action: 'Resume on resume_date or cancel',
    can_pause: false,
    can_cancel: true,
    pause_until: 'ISO8601 date'
  },
  CANCELLED: {
    description: 'No future charges, completed orders still deliver',
    next_action: 'Reactivation (if allowed by policy)',
    can_pause: false,
    can_cancel: false
  }
};

// State transition validation
function canTransition(currentState, targetState) {
  const allowed = {
    'ACTIVE': ['PAUSED', 'CANCELLED'],
    'PAUSED': ['ACTIVE', 'CANCELLED'],
    'CANCELLED': [] // Terminal state
  };
  return allowed[currentState]?.includes(targetState) ?? false;
}

// Safe pause implementation
async function pauseSubscription(subscriptionId, untilDate) {
  const sub = await db.collection('subscriptions').findOne({ _id: subscriptionId });
  
  if (!canTransition(sub.status, 'PAUSED')) {
    throw new Error(`Cannot pause from ${sub.status} state`);
  }
  
  const result = await db.collection('subscriptions').updateOne(
    { _id: subscriptionId },
    { 
      $set: {
        status: 'PAUSED',
        paused_at: new Date(),
        resume_after: untilDate,
        updated_by: 'system'
      }
    }
  );
  
  // Verify the update succeeded
  if (result.modifiedCount !== 1) {
    throw new Error('Pause update failed');
  }
  
  return result;
}
```

---

## Test Plan Template

Create this test plan when preparing for release:

```
TEST COVERAGE FOR [FEATURE/RELEASE]

Unit Tests (Code Logic)
□ Pricing calculation (all VAT rates, edge cases)
□ Subscription state transitions
□ Add-on constraint validation
□ Currency conversion (if applicable)
Pass Rate: __% | Target: 100%

Integration Tests (API + DB)
□ Create order → Verify DB document shape
□ Create subscription → Schedule first delivery
□ Pause subscription → Verify no charge created
□ Cancel subscription → Verify final invoice
□ Retrieve quote → Verify TTL expiry
Pass Rate: __% | Target: 100%

E2E Tests (Complete Workflows)
□ One-time order from search → delivery
□ Subscription setup → 3 recurring cycles
□ Add subscription meals → next delivery includes new meals
□ Pause → Resume subscription
□ Regional VAT (UK, UAE, Egypt)
Pass Rate: __% | Target: 100%

Data Integrity Tests
□ No orphaned order documents
□ All meal references resolve
□ All subscription next_delivery_date in future
□ No duplicate charges in billing history
Pass Rate: __% | Target: 100%

Load/Performance Tests
□ Quote calculation response time < 500ms at 100 req/s
□ Subscription cycle cron processes 10k subscribers < 5min
□ Meal search returns results < 1s with 50k catalog items
Pass Rate: __% | Target: 100%

Staging Validation (Pre-Production)
□ All tests pass in staging environment
□ Manual E2E workflow validation by QA
□ Security review: no credential leaks, proper error handling
□ Approval from: [Backend Lead], [Finance Lead]
```

---

## Audit Schedule

**Before Every Release:**
- Run Pre-Integration Audit Checklist (all items)
- Execute E2E Customer Cycle Validation (all three workflows)
- Review recent failure logs against Failure Analysis Framework

**Weekly:**
- MongoDB schema consistency check
- Index performance audit
- Pricing variance report (flag orders outside normal ranges)

**Monthly:**
- Full data integrity audit across all collections
- Regional VAT compliance audit
- Subscription lifecycle analysis (churn, pause patterns)

---

## Quick Reference: Common Audit Failures & Fixes

| Failure | Cause | Fix | Prevention |
|---------|-------|-----|-----------|
| Subscription charges after cancel | Status not checked in cron | Add status filter to cron query | Update cron test to verify filter |
| VAT calculation off by 1 cent | Rounding order (tax before multiply) | Round after multiply: `(subtotal × rate).round(2)` | Add unit test with rounding edge cases |
| Add-on not available in checkout | Stale cache in frontend | Clear cache on add-on update, return cache-control headers | Add integration test for add-on availability |
| Meal reference broken after delete | No cascade check | Implement soft delete or check referential integrity on delete | Add DB referential integrity constraint |
| Price displayed differently in cart vs checkout | Calculated twice differently | Centralize calculation logic, reuse function | Require quote for all checkouts |

---

## Success Criteria

✓ **Audit Complete When:**
- All checklist items marked ✓ or documented as N/A with reason
- E2E workflows tested in staging, zero blocking failures
- Any failures documented in Failure Analysis format and prioritized
- All non-critical issues tracked in backlog
- Security review approved by backend lead
- No rule violations (no production mutations, no unauthorized changes)

✓ **Safe to Deploy When:**
- All CRITICAL failures resolved and verified
- All HIGH failures have concrete fix timeline
- New tests written for all discovered issues
- Approval obtained from: Backend Lead + relevant domain owner
- Deployment procedure reviewed (no manual steps, automated rollback plan)
