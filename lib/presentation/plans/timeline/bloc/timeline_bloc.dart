import 'package:basic_diet/domain/usecase/get_timeline_usecase.dart';
import 'package:basic_diet/presentation/plans/timeline/bloc/timeline_event.dart';
import 'package:basic_diet/presentation/plans/timeline/bloc/timeline_state.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

class TimelineBloc extends Bloc<TimelineEvent, TimelineState> {
  final GetTimelineUseCase _getTimelineUseCase;

  TimelineBloc(this._getTimelineUseCase) : super(TimelineInitial()) {
    on<FetchTimelineEvent>(_onFetchTimeline);
  }

  Future<void> _onFetchTimeline(
    FetchTimelineEvent event,
    Emitter<TimelineState> emit,
  ) async {
    emit(TimelineLoading());
    final result = await _getTimelineUseCase.execute(event.subscriptionId);
    result.fold(
      (failure) => emit(TimelineError(failure.message)),
      (timeline) => emit(TimelineLoaded(timeline)),
    );
  }
}
