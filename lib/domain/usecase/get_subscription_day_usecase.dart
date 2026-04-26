import 'package:basic_diet/data/network/failure.dart';
import 'package:basic_diet/domain/model/subscription_day_model.dart';
import 'package:basic_diet/domain/repository/repository.dart';
import 'package:basic_diet/domain/usecase/base_usecase.dart';
import 'package:dartz/dartz.dart';

class GetSubscriptionDayUseCaseInput {
  final String subscriptionId;
  final String date;

  GetSubscriptionDayUseCaseInput(this.subscriptionId, this.date);
}

class GetSubscriptionDayUseCase
    implements
        BaseUseCase<GetSubscriptionDayUseCaseInput, SubscriptionDayModel> {
  final Repository _repository;

  GetSubscriptionDayUseCase(this._repository);

  @override
  Future<Either<Failure, SubscriptionDayModel>> execute(
    GetSubscriptionDayUseCaseInput input,
  ) async {
    return await _repository.getSubscriptionDay(
      input.subscriptionId,
      input.date,
    );
  }
}
