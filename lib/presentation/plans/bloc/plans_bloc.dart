import 'package:basic_diet/domain/usecase/get_current_subscription_overview_usecase.dart';
import 'package:basic_diet/domain/usecase/get_timeline_usecase.dart';
import 'package:basic_diet/presentation/plans/bloc/plans_event.dart';
import 'package:basic_diet/presentation/plans/bloc/plans_state.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

class PlansBloc extends Bloc<PlansEvent, PlansState> {
  final GetCurrentSubscriptionOverviewUseCase
  _getCurrentSubscriptionOverviewUseCase;
  final GetTimelineUseCase _getTimelineUseCase;

  PlansBloc(
    this._getCurrentSubscriptionOverviewUseCase,
    this._getTimelineUseCase,
  ) : super(PlansInitial()) {
    on<FetchCurrentSubscriptionOverviewEvent>(
      _onFetchCurrentSubscriptionOverview,
    );
    on<FetchTimelineAndOpenPlannerEvent>(_onFetchTimelineAndOpenPlanner);
  }

  void _onFetchCurrentSubscriptionOverview(
    FetchCurrentSubscriptionOverviewEvent event,
    Emitter<PlansState> emit,
  ) async {
    emit(const PlansLoading());
    final result = await _getCurrentSubscriptionOverviewUseCase.execute(null);
    result.fold(
      (failure) {
        emit(PlansError(failure.message));
      },
      (data) {
        emit(CurrentSubscriptionOverviewLoaded(data));
      },
    );
  }

  void _onFetchTimelineAndOpenPlanner(
    FetchTimelineAndOpenPlannerEvent event,
    Emitter<PlansState> emit,
  ) async {
    final currentData = state.data;
    emit(OpenPlannerLoading(data: currentData));
    final result = await _getTimelineUseCase.execute(event.subscriptionId);
    result.fold(
      (failure) => emit(PlansError(failure.message, data: currentData)),
      (timeline) {
        final days = timeline.data.days;
        final index = days.indexWhere(
          (day) => ![
            'locked',
            'frozen',
            'skipped',
          ].contains(day.status.toLowerCase()),
        );

        if (index != -1) {
          emit(
            NavigateToMealPlannerState(
              timelineDays: days,
              initialDayIndex: index,
              premiumMealsRemaining: timeline.data.premiumMealsRemaining,
              subscriptionId: event.subscriptionId,
              data: currentData,
            ),
          );
        } else {
          emit(PlansError("No available days for meal planning", data: currentData));
        }
      },
    );
  }
}
