import 'package:basic_diet/data/network/failure.dart';
import 'package:basic_diet/domain/model/cancel_subscription_model.dart';
import 'package:basic_diet/domain/repository/repository.dart';
import 'package:basic_diet/domain/usecase/base_usecase.dart';
import 'package:dartz/dartz.dart';

class CancelSubscriptionUseCase
    implements BaseUseCase<String, CancelSubscriptionModel> {
  final Repository _repository;

  CancelSubscriptionUseCase(this._repository);

  @override
  Future<Either<Failure, CancelSubscriptionModel>> execute(
    String subscriptionId,
  ) async {
    return await _repository.cancelSubscription(subscriptionId);
  }
}
