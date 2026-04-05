import 'package:basic_diet/data/network/failure.dart';
import 'package:basic_diet/domain/model/freeze_subscription_model.dart';
import 'package:basic_diet/domain/repository/repository.dart';
import 'package:basic_diet/domain/usecase/base_usecase.dart';
import 'package:dartz/dartz.dart';

class FreezeSubscriptionUseCaseInput {
  final String subscriptionId;
  final FreezeSubscriptionRequestModel request;

  FreezeSubscriptionUseCaseInput(this.subscriptionId, this.request);
}

class FreezeSubscriptionUseCase
    implements BaseUseCase<FreezeSubscriptionUseCaseInput, FreezeSubscriptionModel> {
  final Repository _repository;

  FreezeSubscriptionUseCase(this._repository);

  @override
  Future<Either<Failure, FreezeSubscriptionModel>> execute(
    FreezeSubscriptionUseCaseInput input,
  ) async {
    return await _repository.freezeSubscription(
      input.subscriptionId,
      input.request,
    );
  }
}
