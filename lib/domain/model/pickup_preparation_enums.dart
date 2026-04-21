import 'package:flutter/material.dart';

/// Enum for pickup preparation flow status from Overview API.
enum PickupFlowStatus {
  hidden,
  available,
  disabled,
  inProgress,
  completed;

  static PickupFlowStatus fromString(String value) {
    return switch (value.toLowerCase()) {
      'hidden' => PickupFlowStatus.hidden,
      'available' => PickupFlowStatus.available,
      'disabled' => PickupFlowStatus.disabled,
      'in_progress' => PickupFlowStatus.inProgress,
      'completed' => PickupFlowStatus.completed,
      _ => PickupFlowStatus.hidden,
    };
  }
}

/// Enum for pickup preparation blocked reasons (disabled state).
enum PickupBlockedReason {
  daySkipped,
  dayFrozen,
  restaurantClosed,
  subscriptionInactive,
  subInactive,
  subExpired,
  insufficientCredits,
  paymentRequired,
  premiumPaymentRequired,
  premiumOveragePaymentRequired,
  oneTimeAddonPaymentRequired,
  plannerUnconfirmed,
  planningIncomplete,
  pickupAlreadyRequested,
  pickupAlreadyCompleted,
  pickupAlreadyClosed,
  dayAlreadyConsumed,
  locked,
  invalid,
  invalidDate,
  notFound,
  unknown;

  static PickupBlockedReason fromString(String? value) {
    if (value == null || value.isEmpty) return PickupBlockedReason.unknown;

    return switch (value.toUpperCase()) {
      'DAY_SKIPPED' => PickupBlockedReason.daySkipped,
      'DAY_FROZEN' => PickupBlockedReason.dayFrozen,
      'RESTAURANT_CLOSED' => PickupBlockedReason.restaurantClosed,
      'SUBSCRIPTION_INACTIVE' => PickupBlockedReason.subscriptionInactive,
      'SUB_INACTIVE' => PickupBlockedReason.subInactive,
      'SUB_EXPIRED' => PickupBlockedReason.subExpired,
      'INSUFFICIENT_CREDITS' => PickupBlockedReason.insufficientCredits,
      'PAYMENT_REQUIRED' => PickupBlockedReason.paymentRequired,
      'PREMIUM_PAYMENT_REQUIRED' => PickupBlockedReason.premiumPaymentRequired,
      'PREMIUM_OVERAGE_PAYMENT_REQUIRED' =>
        PickupBlockedReason.premiumOveragePaymentRequired,
      'ONE_TIME_ADDON_PAYMENT_REQUIRED' =>
        PickupBlockedReason.oneTimeAddonPaymentRequired,
      'PLANNER_UNCONFIRMED' => PickupBlockedReason.plannerUnconfirmed,
      'PLANNING_INCOMPLETE' => PickupBlockedReason.planningIncomplete,
      'PICKUP_ALREADY_REQUESTED' => PickupBlockedReason.pickupAlreadyRequested,
      'PICKUP_ALREADY_COMPLETED' => PickupBlockedReason.pickupAlreadyCompleted,
      'PICKUP_ALREADY_CLOSED' => PickupBlockedReason.pickupAlreadyClosed,
      'DAY_ALREADY_CONSUMED' => PickupBlockedReason.dayAlreadyConsumed,
      'LOCKED' => PickupBlockedReason.locked,
      'INVALID' => PickupBlockedReason.invalid,
      'INVALID_DATE' => PickupBlockedReason.invalidDate,
      'NOT_FOUND' => PickupBlockedReason.notFound,
      _ => PickupBlockedReason.unknown,
    };
  }
}

/// Enum for pickup status from GET /pickup/status API.
enum PickupDayStatus {
  open,
  locked,
  inPreparation,
  readyForPickup,
  fulfilled,
  noShow,
  consumedWithoutPreparation;

  static PickupDayStatus fromString(String value) {
    return switch (value.toLowerCase()) {
      'open' => PickupDayStatus.open,
      'locked' => PickupDayStatus.locked,
      'in_preparation' => PickupDayStatus.inPreparation,
      'ready_for_pickup' => PickupDayStatus.readyForPickup,
      'fulfilled' => PickupDayStatus.fulfilled,
      'no_show' => PickupDayStatus.noShow,
      'consumed_without_preparation' =>
        PickupDayStatus.consumedWithoutPreparation,
      _ => PickupDayStatus.open,
    };
  }
}

/// Extension to provide UI metadata for blocked reasons.
extension PickupBlockedReasonX on PickupBlockedReason {
  String get titleKey {
    return switch (this) {
      PickupBlockedReason.daySkipped => 'daySkipped',
      PickupBlockedReason.dayFrozen => 'dayFrozen',
      PickupBlockedReason.restaurantClosed => 'restaurantClosed',
      PickupBlockedReason.subscriptionInactive ||
      PickupBlockedReason.subInactive =>
        'subscriptionInactive',
      PickupBlockedReason.subExpired => 'subscriptionExpired',
      PickupBlockedReason.insufficientCredits => 'insufficientCredits',
      PickupBlockedReason.paymentRequired ||
      PickupBlockedReason.premiumPaymentRequired ||
      PickupBlockedReason.premiumOveragePaymentRequired ||
      PickupBlockedReason.oneTimeAddonPaymentRequired =>
        'paymentRequiredMessage',
      PickupBlockedReason.plannerUnconfirmed => 'plannerUnconfirmed',
      PickupBlockedReason.planningIncomplete => 'orderLocked',
      _ => 'orderLocked',
    };
  }

  String get messageKey {
    return switch (this) {
      PickupBlockedReason.daySkipped => 'daySkippedMessage',
      PickupBlockedReason.dayFrozen => 'dayFrozenMessage',
      PickupBlockedReason.restaurantClosed => 'restaurantClosedMessage',
      PickupBlockedReason.subscriptionInactive ||
      PickupBlockedReason.subInactive =>
        'subscriptionInactive',
      PickupBlockedReason.subExpired => 'subscriptionExpired',
      PickupBlockedReason.insufficientCredits => 'insufficientCredits',
      PickupBlockedReason.paymentRequired ||
      PickupBlockedReason.premiumPaymentRequired ||
      PickupBlockedReason.premiumOveragePaymentRequired ||
      PickupBlockedReason.oneTimeAddonPaymentRequired =>
        'paymentRequiredMessage',
      PickupBlockedReason.plannerUnconfirmed => 'plannerUnconfirmed',
      PickupBlockedReason.planningIncomplete =>
        'reviewSelectionToStartPreparation',
      _ => 'modificationPeriodEnded',
    };
  }

  IconData get icon {
    return switch (this) {
      PickupBlockedReason.daySkipped => Icons.pause_circle_outline_rounded,
      PickupBlockedReason.dayFrozen => Icons.ac_unit_outlined,
      PickupBlockedReason.restaurantClosed => Icons.storefront_outlined,
      PickupBlockedReason.subscriptionInactive ||
      PickupBlockedReason.subInactive ||
      PickupBlockedReason.subExpired =>
        Icons.cancel_outlined,
      PickupBlockedReason.insufficientCredits =>
        Icons.credit_card_off_outlined,
      PickupBlockedReason.paymentRequired ||
      PickupBlockedReason.premiumPaymentRequired ||
      PickupBlockedReason.premiumOveragePaymentRequired ||
      PickupBlockedReason.oneTimeAddonPaymentRequired =>
        Icons.payment_outlined,
      PickupBlockedReason.planningIncomplete => Icons.edit_calendar_outlined,
      PickupBlockedReason.plannerUnconfirmed => Icons.pending_actions_outlined,
      _ => Icons.lock_rounded,
    };
  }

  bool get isActionable {
    return this == PickupBlockedReason.planningIncomplete ||
        this == PickupBlockedReason.plannerUnconfirmed;
  }
}
