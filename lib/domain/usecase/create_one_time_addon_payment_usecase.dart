import 'package:basic_diet/data/network/failure.dart';
import 'package:basic_diet/domain/model/premium_payment_model.dart';
import 'package:basic_diet/domain/repository/repository.dart';
import 'package:basic_diet/domain/usecase/base_usecase.dart';
import 'package:dartz/dartz.dart';

class CreateOneTimeAddonPaymentUseCaseInput {
  final String subscriptionId;
  final String date;

  CreateOneTimeAddonPaymentUseCaseInput(this.subscriptionId, this.date);
}

class CreateOneTimeAddonPaymentUseCase
    implements
        BaseUseCase<
          CreateOneTimeAddonPaymentUseCaseInput,
          PremiumPaymentModel
        > {
  final Repository _repository;

  CreateOneTimeAddonPaymentUseCase(this._repository);

  @override
  Future<Either<Failure, PremiumPaymentModel>> execute(
    CreateOneTimeAddonPaymentUseCaseInput input,
  ) async {
    return await _repository.createOneTimeAddonPayment(
      input.subscriptionId,
      input.date,
    );
  }
}
