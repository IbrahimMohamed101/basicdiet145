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

  const SetMealSlotCarbEvent({
    required this.slotIndex,
    required this.carbId,
  });

  @override
  List<Object?> get props => [slotIndex, carbId];
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
