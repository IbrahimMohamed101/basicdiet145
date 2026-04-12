import 'package:basic_diet/app/constants.dart';
import 'package:basic_diet/app/extensions.dart';
import 'package:basic_diet/data/response/timeline_response.dart';
import 'package:basic_diet/domain/model/timeline_model.dart';

extension TimelineDayResponseMapper on TimelineDayResponse? {
  TimelineDayModel toDomain() {
    return TimelineDayModel(
      date: this?.date.orEmpty() ?? Constants.empty,
      day: this?.day.orEmpty() ?? Constants.empty,
      month: this?.month.orEmpty() ?? Constants.empty,
      dayNumber: this?.dayNumber.orZero() ?? Constants.zero,
      status: this?.status.orEmpty() ?? Constants.empty,
      selectedMeals: this?.selectedMeals.orZero() ?? Constants.zero,
      requiredMeals: this?.requiredMeals.orZero() ?? Constants.zero,
      selections: this?.selections ?? [],
      premiumSelections: this?.premiumSelections ?? [],
    );
  }
}

extension TimelineDataResponseMapper on TimelineDataResponse? {
  TimelineDataModel toDomain() {
    return TimelineDataModel(
      subscriptionId: this?.subscriptionId.orEmpty() ?? Constants.empty,
      dailyMealsRequired: this?.dailyMealsRequired.orZero() ?? Constants.zero,
      premiumMealsRemaining:
          this?.premiumMealsRemaining.orZero() ?? Constants.zero,
      days: (this?.days?.map((e) => e.toDomain()).toList()) ?? [],
    );
  }
}

extension TimelineResponseMapper on TimelineResponse? {
  TimelineModel toDomain() {
    return TimelineModel(
      data:
          this?.data.toDomain() ??
          TimelineDataModel(
            subscriptionId: Constants.empty,
            dailyMealsRequired: Constants.zero,
            premiumMealsRemaining: Constants.zero,
            days: [],
          ),
    );
  }
}
