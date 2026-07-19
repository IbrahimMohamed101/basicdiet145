from pathlib import Path

TARGET = Path("src/services/subscription/unifiedDayPaymentService.js")
text = TARGET.read_text()


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    text = text.replace(old, new, 1)


helper = '''async function releasePaymentInitiationReservations({
  subscriptionId,
  entitlementReservation,
  reason,
  newlyReservedOnly = false,
}) {
  const rawKeys = newlyReservedOnly
    ? entitlementReservation && entitlementReservation.newlyReservedKeys
    : entitlementReservation && entitlementReservation.allocationKeys;
  const allocationKeys = [...new Set((Array.isArray(rawKeys) ? rawKeys : [])
    .map((key) => String(key || ""))
    .filter(Boolean))];

  let releasedCount = 0;
  for (const allocationKey of allocationKeys) {
    try {
      const result = await transitionAllocation({
        subscriptionId,
        allocationKey,
        toState: "released",
      });
      if (result.changed) releasedCount += 1;
    } catch (err) {
      logger.error("Unified day payment initiation: entitlement release failed", {
        subscriptionId: String(subscriptionId || ""),
        allocationKey,
        reason,
        code: err.code || "ENTITLEMENT_RELEASE_FAILED",
        error: err.message,
      });
    }
  }
  return releasedCount;
}'''

replace_once(
    "\n}\n\nfunction buildPendingPremiumSnapshot(day) {",
    "\n}\n\n" + helper + "\n\nfunction buildPendingPremiumSnapshot(day) {",
    "insert cleanup helper",
)

replace_once(
    "    if (!idempotency.ok) return idempotency;",
    '''    if (!idempotency.ok) {
      await releasePaymentInitiationReservations({
        subscriptionId: sub._id,
        entitlementReservation,
        reason: "idempotency_rejected",
        newlyReservedOnly: true,
      });
      return idempotency;
    }''',
    "idempotency rejection cleanup",
)

replace_once(
    "      if (!reusedPayment) return idempotency;",
    '''      if (!reusedPayment) {
        await releasePaymentInitiationReservations({
          subscriptionId: sub._id,
          entitlementReservation,
          reason: "idempotency_reuse_missing",
          newlyReservedOnly: true,
        });
        return idempotency;
      }''',
    "missing idempotent payment cleanup",
)

replace_once(
    '''      for (const allocationKey of entitlementReservation.newlyReservedKeys) {
        await transitionAllocation({ subscriptionId: sub._id, allocationKey, toState: "released" });
      }''',
    '''      await releasePaymentInitiationReservations({
        subscriptionId: sub._id,
        entitlementReservation,
        reason: "provider_invoice_creation_failed",
      });''',
    "provider failure cleanup",
)

replace_once(
    '''      return buildErrorResult(500, "CONFIG", `Invoice currency must use ${SYSTEM_CURRENCY}`);''',
    '''      await releasePaymentInitiationReservations({
        subscriptionId: sub._id,
        entitlementReservation,
        reason: "provider_invoice_currency_mismatch",
      });
      return buildErrorResult(500, "CONFIG", `Invoice currency must use ${SYSTEM_CURRENCY}`);''',
    "currency mismatch cleanup",
)

replace_once(
    '''      logger.error("Unified day payment initiation: createPayment failed", { error: err.message, code: err.code, subscriptionId, date });''',
    '''      await releasePaymentInitiationReservations({
        subscriptionId: sub._id,
        entitlementReservation,
        reason: "payment_persistence_failed",
      });
      logger.error("Unified day payment initiation: createPayment failed", { error: err.message, code: err.code, subscriptionId, date });''',
    "payment persistence cleanup",
)

replace_once(
    '''    const paymentId = payment && payment._id ? payment._id : payment && payment.id ? payment.id : null;
    if (paymentId && entitlementReservation.allocationKeys.length) {
      await linkPaymentToAllocations({
        subscriptionId: sub._id,
        allocationKeys: entitlementReservation.allocationKeys,
        paymentId,
      });
    }''',
    '''    const paymentId = payment && payment._id ? payment._id : payment && payment.id ? payment.id : null;
    if (!paymentId) {
      await releasePaymentInitiationReservations({
        subscriptionId: sub._id,
        entitlementReservation,
        reason: "payment_identifier_missing",
      });
      return buildErrorResult(500, "PAYMENT_PERSISTENCE_ERROR", "Failed to record payment initiation");
    }
    if (entitlementReservation.allocationKeys.length) {
      try {
        await linkPaymentToAllocations({
          subscriptionId: sub._id,
          allocationKeys: entitlementReservation.allocationKeys,
          paymentId,
        });
      } catch (err) {
        await releasePaymentInitiationReservations({
          subscriptionId: sub._id,
          entitlementReservation,
          reason: "payment_allocation_link_failed",
        });
        await markPaymentInitiationFailed(payment, "payment_allocation_link_failed");
        logger.error("Unified day payment initiation: allocation link failed", { error: err.message, subscriptionId, date });
        return buildErrorResult(500, "PAYMENT_PERSISTENCE_ERROR", "Failed to link payment to reserved meal entitlement");
      }
    }''',
    "allocation linking cleanup",
)

replace_once(
    '''        logger.error("Unified day payment initiation: day update failed", { error: err.message, subscriptionId, date });''',
    '''        await releasePaymentInitiationReservations({
          subscriptionId: sub._id,
          entitlementReservation,
          reason: "subscription_day_update_failed",
        });
        logger.error("Unified day payment initiation: day update failed", { error: err.message, subscriptionId, date });''',
    "day update exception cleanup",
)

replace_once(
    '''        await markPaymentInitiationFailed(payment, "subscription_day_not_open");''',
    '''        await releasePaymentInitiationReservations({
          subscriptionId: sub._id,
          entitlementReservation,
          reason: "subscription_day_not_open",
        });
        await markPaymentInitiationFailed(payment, "subscription_day_not_open");''',
    "locked day cleanup",
)

replace_once(
    '''        if (!isDayLinkedToPayment(latestDay, payment, derivedDay.plannerRevisionHash)) {
          await markPaymentInitiationFailed(payment, "subscription_day_update_failed");''',
    '''        if (!isDayLinkedToPayment(latestDay, payment, derivedDay.plannerRevisionHash)) {
          await releasePaymentInitiationReservations({
            subscriptionId: sub._id,
            entitlementReservation,
            reason: "subscription_day_link_not_persisted",
          });
          await markPaymentInitiationFailed(payment, "subscription_day_update_failed");''',
    "unpersisted day link cleanup",
)

TARGET.write_text(text)
