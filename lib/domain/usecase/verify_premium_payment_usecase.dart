import 'package:basic_diet/data/network/failure.dart';
import 'package:basic_diet/domain/model/premium_payment_model.dart';
import 'package:basic_diet/domain/repository/repository.dart';
import 'package:basic_diet/domain/usecase/base_usecase.dart';
import 'package:dartz/dartz.dart';

class VerifyPremiumPaymentUseCaseInput {
  final String subscriptionId;
  final String date;
  final String paymentId;

  VerifyPremiumPaymentUseCaseInput(this.subscriptionId, this.date, this.paymentId);
}

class VerifyPremiumPaymentUseCase implements BaseUseCase<VerifyPremiumPaymentUseCaseInput, PremiumPaymentVerificationModel> {
  final Repository _repository;

  VerifyPremiumPaymentUseCase(this._repository);

  @override
  Future<Either<Failure, PremiumPaymentVerificationModel>> execute(VerifyPremiumPaymentUseCaseInput input) async {
    return await _repository.verifyPremiumPayment(input.subscriptionId, input.date, input.paymentId);
  }
}
