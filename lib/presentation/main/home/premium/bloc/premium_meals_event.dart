sealed class PremiumMealsEvent {
  const PremiumMealsEvent();
}

class GetPremiumMealsEvent extends PremiumMealsEvent {
  const GetPremiumMealsEvent();
}

class UpdateMealCounterEvent extends PremiumMealsEvent {
  final String id;
  final int quantity;

  const UpdateMealCounterEvent(this.id, this.quantity);
}
