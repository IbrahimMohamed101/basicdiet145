import 'package:basic_diet/domain/model/add_ons_model.dart';
import 'package:equatable/equatable.dart';

sealed class MealPlannerEvent extends Equatable {
  const MealPlannerEvent();

  @override
  List<Object?> get props => [];
}

final class GetMealPlannerDataEvent extends MealPlannerEvent {
  const GetMealPlannerDataEvent();
}

final class ChangeDateEvent extends MealPlannerEvent {
  final int index;
  const ChangeDateEvent(this.index);

  @override
  List<Object?> get props => [index];
}

final class RetrySelectedDayLoadEvent extends MealPlannerEvent {
  const RetrySelectedDayLoadEvent();
}

final class SetMealSlotProteinEvent extends MealPlannerEvent {
  final int slotIndex;
  final String? proteinId;

  const SetMealSlotProteinEvent({
    required this.slotIndex,
    required this.proteinId,
  });

  @override
  List<Object?> get props => [slotIndex, proteinId];
}

final class SetMealSlotCarbEvent extends MealPlannerEvent {
  final int slotIndex;
  final String? carbId;

  const SetMealSlotCarbEvent({required this.slotIndex, required this.carbId});

  @override
  List<Object?> get props => [slotIndex, carbId];
}

final class ToggleAddOnSelectionEvent extends MealPlannerEvent {
  final AddOnModel addOn;

  const ToggleAddOnSelectionEvent(this.addOn);

  @override
  List<Object?> get props => [addOn];
}

/// Selects a specific addon for its category, deselecting any previous selection
/// in that category. Pass [addonId] as null to clear the category selection.
final class SelectAddonForCategoryEvent extends MealPlannerEvent {
  final String category;
  final String? addonId;

  const SelectAddonForCategoryEvent({
    required this.category,
    required this.addonId,
  });

  @override
  List<Object?> get props => [category, addonId];
}

final class DismissPendingAddonPromptEvent extends MealPlannerEvent {
  const DismissPendingAddonPromptEvent();
}

final class SaveMealPlannerChangesEvent extends MealPlannerEvent {
  const SaveMealPlannerChangesEvent();
}

final class HideBannerEvent extends MealPlannerEvent {
  const HideBannerEvent();
}

final class InitiatePremiumPaymentEvent extends MealPlannerEvent {
  const InitiatePremiumPaymentEvent();
}

final class VerifyPremiumPaymentEvent extends MealPlannerEvent {
  final String paymentId;

  const VerifyPremiumPaymentEvent(this.paymentId);

  @override
  List<Object?> get props => [paymentId];
}

final class InitiateAddonPaymentEvent extends MealPlannerEvent {
  const InitiateAddonPaymentEvent();
}

final class VerifyAddonPaymentEvent extends MealPlannerEvent {
  final String paymentId;

  const VerifyAddonPaymentEvent(this.paymentId);

  @override
  List<Object?> get props => [paymentId];
}
