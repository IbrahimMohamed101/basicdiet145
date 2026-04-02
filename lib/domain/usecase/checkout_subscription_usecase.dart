import 'package:basic_diet/data/network/failure.dart';
import 'package:basic_diet/domain/model/subscription_checkout_model.dart';
import 'package:basic_diet/domain/repository/repository.dart';
import 'package:basic_diet/domain/usecase/base_usecase.dart';
import 'package:dartz/dartz.dart';

class CheckoutSubscriptionUseCase
    implements
        BaseUseCase<
          SubscriptionCheckoutRequestModel,
          SubscriptionCheckoutModel
        > {
  final Repository _repository;

  CheckoutSubscriptionUseCase(this._repository);

  @override
  Future<Either<Failure, SubscriptionCheckoutModel>> execute(
    SubscriptionCheckoutRequestModel input,
  ) async {
    return await _repository.checkoutSubscription(input);
  }
}
