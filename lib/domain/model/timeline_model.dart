class TimelineMealSlot {
  final int slotIndex;
  final String? proteinId;
  final String? carbId;

  const TimelineMealSlot({
    required this.slotIndex,
    this.proteinId,
    this.carbId,
  });
}

class TimelineDayModel {
  final String date;
  final String day;
  final String month;
  final int dayNumber;
  final String status;
  final int selectedMeals;
  final int requiredMeals;
  final List<String> selections;
  final List<String> premiumSelections;
  final List<TimelineMealSlot> mealSlots;

  TimelineDayModel({
    required this.date,
    required this.day,
    required this.month,
    required this.dayNumber,
    required this.status,
    required this.selectedMeals,
    required this.requiredMeals,
    required this.selections,
    required this.premiumSelections,
    this.mealSlots = const [],
  });
}

class TimelineDataModel {
  final String subscriptionId;
  final int dailyMealsRequired;
  final int premiumMealsRemaining;
  final List<TimelineDayModel> days;

  TimelineDataModel({
    required this.subscriptionId,
    required this.dailyMealsRequired,
    required this.premiumMealsRemaining,
    required this.days,
  });
}

class TimelineModel {
  final TimelineDataModel data;

  TimelineModel({required this.data});
}
