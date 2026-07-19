from pathlib import Path
import re

TARGET = Path("src/services/subscription/unifiedDayPaymentService.js")
text = TARGET.read_text()


def sub_once(pattern: str, replacement: str, label: str, flags: int = 0) -> None:
    global text
    text, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")


helper = r'''
async function releasePaymentInitiationReservations({
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
}
'''.strip("\n")

sub_once(
    r'\n}\n\nfunction buildPendingPremiumSnapshot\(day\) \{',
    "\n}\n\n" + helper + "\n\nfunction buildPendingPremiumSnapshot(day) {",
    "insert cleanup helper",
)

sub_once(
    r'(?m)^\s{4}if \(!idempotency\.ok\) return idempotency;\s*$',
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

sub_once(
    r'(?m)^\s{6}if \(!reusedPayment\) return idempotency;\s*$',
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

sub_once(
    r'''      for \(const allocationKey of entitlementReservation\.newlyReservedKeys\) \{\n        await transitionAllocation\(\{ subscriptionId: sub\._id, allocationKey, toState: "released" \}\);\n      \}''',
    '''      await releasePaymentInitiationReservations({
        subscriptionId: sub._id,
        entitlementReservation,
        reason: "provider_invoice_creation_failed",
      });''',
    "provider failure cleanup",
)

sub_once(
    r'''    if \(invoiceCurrency !== SYSTEM_CURRENCY\) \{\n      return buildErrorResult\(500, "CONFIG", `Invoice currency must use \$\{SYSTEM_CURRENCY\}`\);\n    \}''',
    '''    if (invoiceCurrency !== SYSTEM_CURRENCY) {
      await releasePaymentInitiationReservations({
        subscriptionId: sub._id,
        entitlementReservation,
        reason: "provider_invoice_currency_mismatch",
      });
      return buildErrorResult(500, "CONFIG", `Invoice currency must use ${SYSTEM_CURRENCY}`);
    }''',
    "currency mismatch cleanup",
)

sub_once(
    r'''    \} catch \(err\) \{\n      logger\.error\("Unified day payment initiation: createPayment failed",''',
    '''    } catch (err) {
      await releasePaymentInitiationReservations({
        subscriptionId: sub._id,
        entitlementReservation,
        reason: "payment_persistence_failed",
      });
      logger.error("Unified day payment initiation: createPayment failed",''',
    "payment persistence cleanup",
)

sub_once(
    r'''    const paymentId = payment && payment\._id \? payment\._id : payment && payment\.id \? payment\.id : null;\n    if \(paymentId && entitlementReservation\.allocationKeys\.length\) \{\n      await linkPaymentToAllocations\(\{\n        subscriptionId: sub\._id,\n        allocationKeys: entitlementReservation\.allocationKeys,\n        paymentId,\n      \}\);\n    \}''',
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

sub_once(
    r'''      \} catch \(err\) \{\n        logger\.error\("Unified day payment initiation: day update failed",''',
    '''      } catch (err) {
        await releasePaymentInitiationReservations({
          subscriptionId: sub._id,
          entitlementReservation,
          reason: "subscription_day_update_failed",
        });
        logger.error("Unified day payment initiation: day update failed",''',
    "day update exception cleanup",
)

sub_once(
    r'''      if \(matchedCount === 0\) \{\n        await markPaymentInitiationFailed\(payment, "subscription_day_not_open"\);''',
    '''      if (matchedCount === 0) {
        await releasePaymentInitiationReservations({
          subscriptionId: sub._id,
          entitlementReservation,
          reason: "subscription_day_not_open",
        });
        await markPaymentInitiationFailed(payment, "subscription_day_not_open");''',
    "locked day cleanup",
)

sub_once(
    r'''        if \(!isDayLinkedToPayment\(latestDay, payment, derivedDay\.plannerRevisionHash\)\) \{\n          await markPaymentInitiationFailed\(payment, "subscription_day_update_failed"\);''',
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
