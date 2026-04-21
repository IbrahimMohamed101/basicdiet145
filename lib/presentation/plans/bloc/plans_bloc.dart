import 'package:basic_diet/domain/usecase/get_current_subscription_overview_usecase.dart';
import 'package:basic_diet/domain/model/timeline_model.dart';
import 'package:basic_diet/domain/usecase/get_timeline_usecase.dart';
import 'package:basic_diet/domain/usecase/prepare_pickup_usecase.dart';
import 'package:basic_diet/presentation/plans/bloc/plans_event.dart';
import 'package:basic_diet/presentation/plans/bloc/plans_state.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

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

  String _resolveOperationalDayFromTimeline(TimelineModel timeline) {
    final days = timeline.data.days;

    for (final day in days) {
      if (day.consumptionState == 'consumable_today') {
        return day.date;
      }
    }

    for (final day in days) {
      if (day.canBePrepared || day.fulfillmentReady) {
        return day.date;
      }
    }

    return '';
  }

  Future<String> _resolveBusinessDate({
    required String subscriptionId,
    required String preferredDate,
  }) async {
    if (preferredDate.isNotEmpty) return preferredDate;

    final timelineResult = await _getTimelineUseCase.execute(subscriptionId);
    return timelineResult.fold(
      (_) => '',
      (timeline) => _resolveOperationalDayFromTimeline(timeline),
    );
  }

  void _onFetchCurrentSubscriptionOverview(
    FetchCurrentSubscriptionOverviewEvent event,
    Emitter<PlansState> emit,
  ) async {
    emit(const PlansLoading());
    final result = await _getCurrentSubscriptionOverviewUseCase.execute(null);
    await result.fold(
      (failure) {
        emit(PlansError(failure.message));
      },
      (data) async {
        final overview = data.data;
        final needsOperationalDay =
            overview != null &&
            overview.deliveryMode == 'pickup' &&
            overview.businessDate.isEmpty;

        if (needsOperationalDay) {
          overview.businessDate = await _resolveBusinessDate(
            subscriptionId: overview.id,
            preferredDate: overview.businessDate,
          );
        }

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
        final today =
            event.preferredDate.isNotEmpty
                ? event.preferredDate
                : _resolveOperationalDayFromTimeline(timeline);
        int index = -1;

        if (event.openCurrentDay) {
          index = days.indexWhere(
            (day) =>
                day.date.startsWith(today) &&
                availableStatuses.contains(day.status.toLowerCase()),
          );
        }

        index =
            index == -1
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

    final resolvedDate = await _resolveBusinessDate(
      subscriptionId: event.subscriptionId,
      preferredDate: event.businessDate,
    );

    if (resolvedDate.isEmpty) {
      emit(PlansError('Unable to resolve pickup day', data: currentData));
      return;
    }

    final result = await _preparePickupUseCase.execute(
      PreparePickupUseCaseInput(event.subscriptionId, resolvedDate),
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
