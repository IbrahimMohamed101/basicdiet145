import 'package:basic_diet/data/network/failure.dart';
import 'package:basic_diet/domain/model/checkout_draft_model.dart';
import 'package:basic_diet/domain/repository/repository.dart';
import 'package:basic_diet/domain/usecase/base_usecase.dart';
import 'package:dartz/dartz.dart';

class GetCheckoutDraftUseCase implements BaseUseCase<String, CheckoutDraftModel> {
  final Repository _repository;

  GetCheckoutDraftUseCase(this._repository);

  @override
  Future<Either<Failure, CheckoutDraftModel>> execute(String input) async {
    return await _repository.getCheckoutDraft(input);
  }
}
