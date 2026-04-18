import 'package:basic_diet/data/network/failure.dart';
import 'package:basic_diet/domain/model/premium_payment_model.dart';
import 'package:basic_diet/domain/repository/repository.dart';
import 'package:basic_diet/domain/usecase/base_usecase.dart';
import 'package:dartz/dartz.dart';

class CreatePremiumPaymentUseCaseInput {
  final String subscriptionId;
  final String date;

  CreatePremiumPaymentUseCaseInput(this.subscriptionId, this.date);
}

class CreatePremiumPaymentUseCase implements BaseUseCase<CreatePremiumPaymentUseCaseInput, PremiumPaymentModel> {
  final Repository _repository;

  CreatePremiumPaymentUseCase(this._repository);

  @override
  Future<Either<Failure, PremiumPaymentModel>> execute(CreatePremiumPaymentUseCaseInput input) async {
    return await _repository.createPremiumPayment(input.subscriptionId, input.date);
  }
}
