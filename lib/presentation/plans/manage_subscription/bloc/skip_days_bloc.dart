import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:basic_diet/domain/usecase/skip_day_usecase.dart';
import 'package:basic_diet/domain/usecase/skip_date_range_usecase.dart';
import 'package:basic_diet/presentation/plans/manage_subscription/bloc/skip_days_event.dart';
import 'package:basic_diet/presentation/plans/manage_subscription/bloc/skip_days_state.dart';

class SkipDaysBloc extends Bloc<SkipDaysEvent, SkipDaysState> {
  final SkipDayUseCase _skipDayUseCase;
  final SkipDateRangeUseCase _skipDateRangeUseCase;

  SkipDaysBloc(this._skipDayUseCase, this._skipDateRangeUseCase) : super(SkipDaysInitial()) {
    on<SkipSingleDayEvent>(_onSkipSingleDay);
    on<SkipDateRangeEvent>(_onSkipDateRange);
  }

  Future<void> _onSkipSingleDay(SkipSingleDayEvent event, Emitter<SkipDaysState> emit) async {
    emit(SkipDaysLoading());
    final result = await _skipDayUseCase.execute(SkipDayUseCaseInput(event.id, event.date));
    result.fold(
      (failure) => emit(SkipDaysError(failure.message)),
      (response) => emit(SkipDaysSuccess(response.message ?? "Day skipped successfully!")),
    );
  }

  Future<void> _onSkipDateRange(SkipDateRangeEvent event, Emitter<SkipDaysState> emit) async {
    emit(SkipDaysLoading());
    final result = await _skipDateRangeUseCase.execute(
      SkipDateRangeUseCaseInput(event.id, event.startDate, event.endDate),
    );
    result.fold(
      (failure) => emit(SkipDaysError(failure.message)),
      (response) => emit(SkipDaysSuccess(response.message ?? "Range skipped successfully!")),
    );
  }
}
