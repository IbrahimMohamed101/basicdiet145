import 'package:basic_diet/domain/usecase/get_current_subscription_overview_usecase.dart';
import 'package:basic_diet/domain/usecase/get_timeline_usecase.dart';
import 'package:basic_diet/domain/usecase/prepare_pickup_usecase.dart';
import 'package:basic_diet/presentation/plans/bloc/plans_event.dart';
import 'package:basic_diet/presentation/plans/bloc/plans_state.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:intl/intl.dart';

class PlansBloc extends Bloc<PlansEvent, PlansState> {
  final GetCurrentSubscriptionOverviewUseCase
  _getCurrentSubscriptionOverviewUseCase;
  final GetTimelineUseCase _getTimelineUseCase;
  final PreparePickupUseCase _preparePickupUseCase;

  PlansBloc(
    this._getCurrentSubscriptionOverviewUseCase,
    this._getTimelineUseCase,
    this._preparePickupUseCase,
  ) : super(const PlansInitial()) {
    on<FetchCurrentSubscriptionOverviewEvent>(
      _onFetchCurrentSubscriptionOverview,
    );
    on<FetchTimelineAndOpenPlannerEvent>(_onFetchTimelineAndOpenPlanner);
    on<PreparePickupEvent>(_onPreparePickup);
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
        final availableStatuses = ['open', 'planned', 'extension'];
        final today = DateFormat('yyyy-MM-dd').format(DateTime.now());
        int index = -1;

        if (event.openCurrentDay) {
          index = days.indexWhere(
            (day) =>
                day.date.startsWith(today) &&
                availableStatuses.contains(day.status.toLowerCase()),
          );
        }

        index = index == -1
            ? days.indexWhere(
                (day) => availableStatuses.contains(day.status.toLowerCase()),
              )
            : index;

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
          emit(
            PlansError(
              "No available days for meal planning",
              data: currentData,
            ),
          );
        }
      },
    );
  }

  void _onPreparePickup(
    PreparePickupEvent event,
    Emitter<PlansState> emit,
  ) async {
    final currentData = state.data;
    emit(PreparePickupLoading(data: currentData));

    final today = DateFormat('yyyy-MM-dd').format(DateTime.now());
    final result = await _preparePickupUseCase.execute(
      PreparePickupUseCaseInput(event.subscriptionId, today),
    );

    result.fold(
      (failure) => emit(PlansError(failure.message, data: currentData)),
      (data) {
        emit(PreparePickupSuccess(data: currentData));
        add(FetchCurrentSubscriptionOverviewEvent());
      },
    );
  }
}
