import 'package:basic_diet/data/network/failure.dart';
import 'package:basic_diet/domain/model/premium_payment_model.dart';
import 'package:basic_diet/domain/repository/repository.dart';
import 'package:basic_diet/domain/usecase/base_usecase.dart';
import 'package:dartz/dartz.dart';

class VerifyOneTimeAddonPaymentUseCaseInput {
  final String subscriptionId;
  final String date;
  final String paymentId;

  VerifyOneTimeAddonPaymentUseCaseInput(
    this.subscriptionId,
    this.date,
    this.paymentId,
  );
}

class VerifyOneTimeAddonPaymentUseCase
    implements
        BaseUseCase<
          VerifyOneTimeAddonPaymentUseCaseInput,
          PremiumPaymentVerificationModel
        > {
  final Repository _repository;

  VerifyOneTimeAddonPaymentUseCase(this._repository);

  @override
  Future<Either<Failure, PremiumPaymentVerificationModel>> execute(
    VerifyOneTimeAddonPaymentUseCaseInput input,
  ) async {
    return await _repository.verifyOneTimeAddonPayment(
      input.subscriptionId,
      input.date,
      input.paymentId,
    );
  }
}
