import 'package:basic_diet/data/network/failure.dart';
import 'package:basic_diet/data/request/day_selection_request.dart';
import 'package:basic_diet/domain/model/subscription_day_model.dart';
import 'package:basic_diet/domain/repository/repository.dart';
import 'package:basic_diet/domain/usecase/base_usecase.dart';
import 'package:dartz/dartz.dart';

class SaveDaySelectionUseCaseInput {
  final String subscriptionId;
  final String date;
  final DaySelectionRequest request;

  SaveDaySelectionUseCaseInput(
    this.subscriptionId,
    this.date,
    this.request,
  );
}

class SaveDaySelectionUseCase
    implements BaseUseCase<SaveDaySelectionUseCaseInput, SubscriptionDayModel> {
  final Repository _repository;

  SaveDaySelectionUseCase(this._repository);

  @override
  Future<Either<Failure, SubscriptionDayModel>> execute(
    SaveDaySelectionUseCaseInput input,
  ) async {
    return await _repository.saveDaySelection(
      input.subscriptionId,
      input.date,
      input.request,
    );
  }
}
