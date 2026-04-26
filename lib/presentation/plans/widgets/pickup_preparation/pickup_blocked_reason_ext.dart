import 'package:basic_diet/domain/model/pickup_preparation_enums.dart';
import 'package:flutter/material.dart';

/// Presentation-layer extension on [PickupBlockedReason].
/// Provides UI metadata: icon, title key, message key.
/// Kept in presentation to respect Clean Architecture — domain stays pure Dart.
extension PickupBlockedReasonX on PickupBlockedReason {
  String get titleKey => switch (this) {
    PickupBlockedReason.daySkipped => 'daySkipped',
    PickupBlockedReason.dayFrozen => 'dayFrozen',
    PickupBlockedReason.restaurantClosed => 'restaurantClosed',
    PickupBlockedReason.subscriptionInactive ||
    PickupBlockedReason.subInactive => 'subscriptionInactive',
    PickupBlockedReason.subExpired => 'subscriptionExpired',
    PickupBlockedReason.insufficientCredits => 'insufficientCredits',
    PickupBlockedReason.paymentRequired ||
    PickupBlockedReason.premiumPaymentRequired ||
    PickupBlockedReason.premiumOveragePaymentRequired ||
    PickupBlockedReason.oneTimeAddonPaymentRequired => 'paymentRequiredMessage',
    PickupBlockedReason.plannerUnconfirmed => 'plannerUnconfirmed',
    PickupBlockedReason.planningIncomplete => 'orderLocked',
    _ => 'orderLocked',
  };

  String get messageKey => switch (this) {
    PickupBlockedReason.daySkipped => 'daySkippedMessage',
    PickupBlockedReason.dayFrozen => 'dayFrozenMessage',
    PickupBlockedReason.restaurantClosed => 'restaurantClosedMessage',
    PickupBlockedReason.subscriptionInactive ||
    PickupBlockedReason.subInactive => 'subscriptionInactive',
    PickupBlockedReason.subExpired => 'subscriptionExpired',
    PickupBlockedReason.insufficientCredits => 'insufficientCredits',
    PickupBlockedReason.paymentRequired ||
    PickupBlockedReason.premiumPaymentRequired ||
    PickupBlockedReason.premiumOveragePaymentRequired ||
    PickupBlockedReason.oneTimeAddonPaymentRequired => 'paymentRequiredMessage',
    PickupBlockedReason.plannerUnconfirmed => 'plannerUnconfirmed',
    PickupBlockedReason.planningIncomplete =>
      'reviewSelectionToStartPreparation',
    _ => 'modificationPeriodEnded',
  };

  IconData get icon => switch (this) {
    PickupBlockedReason.daySkipped => Icons.pause_circle_outline_rounded,
    PickupBlockedReason.dayFrozen => Icons.ac_unit_outlined,
    PickupBlockedReason.restaurantClosed => Icons.storefront_outlined,
    PickupBlockedReason.subscriptionInactive ||
    PickupBlockedReason.subInactive ||
    PickupBlockedReason.subExpired => Icons.cancel_outlined,
    PickupBlockedReason.insufficientCredits => Icons.credit_card_off_outlined,
    PickupBlockedReason.paymentRequired ||
    PickupBlockedReason.premiumPaymentRequired ||
    PickupBlockedReason.premiumOveragePaymentRequired ||
    PickupBlockedReason.oneTimeAddonPaymentRequired => Icons.payment_outlined,
    PickupBlockedReason.planningIncomplete => Icons.edit_calendar_outlined,
    PickupBlockedReason.plannerUnconfirmed => Icons.pending_actions_outlined,
    _ => Icons.lock_rounded,
  };
}
