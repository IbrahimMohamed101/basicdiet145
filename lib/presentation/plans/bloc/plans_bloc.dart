import 'package:basic_diet/domain/usecase/get_current_subscription_overview_usecase.dart';
import 'package:basic_diet/presentation/plans/bloc/plans_event.dart';
import 'package:basic_diet/presentation/plans/bloc/plans_state.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

class PlansBloc extends Bloc<PlansEvent, PlansState> {
  final GetCurrentSubscriptionOverviewUseCase
  _getCurrentSubscriptionOverviewUseCase;

  PlansBloc(this._getCurrentSubscriptionOverviewUseCase)
    : super(PlansInitial()) {
    on<FetchCurrentSubscriptionOverviewEvent>(
      _onFetchCurrentSubscriptionOverview,
    );
  }

  void _onFetchCurrentSubscriptionOverview(
    FetchCurrentSubscriptionOverviewEvent event,
    Emitter<PlansState> emit,
  ) async {
    emit(PlansLoading());
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
}
