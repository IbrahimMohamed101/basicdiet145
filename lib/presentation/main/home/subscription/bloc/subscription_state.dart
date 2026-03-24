import 'package:basic_diet/domain/model/plans_model.dart';
import 'package:equatable/equatable.dart';

abstract class SubscriptionState extends Equatable {
  const SubscriptionState();

  @override
  List<Object?> get props => [];
}

class SubscriptionInitial extends SubscriptionState {
  const SubscriptionInitial();
}

class SubscriptionLoading extends SubscriptionState {
  const SubscriptionLoading();
}

class SubscriptionSuccess extends SubscriptionState {
  final PlansModel plansModel;
  final MealOptionModel? selectedMealOption;

  const SubscriptionSuccess(this.plansModel, {this.selectedMealOption});

  SubscriptionSuccess copyWith({
    PlansModel? plansModel,
    MealOptionModel? selectedMealOption,
  }) {
    return SubscriptionSuccess(
      plansModel ?? this.plansModel,
      selectedMealOption: selectedMealOption ?? this.selectedMealOption,
    );
  }

  @override
  List<Object?> get props => [plansModel, selectedMealOption];
}

class SubscriptionError extends SubscriptionState {
  final String message;
  const SubscriptionError(this.message);

  @override
  List<Object?> get props => [message];
}
