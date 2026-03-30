import 'package:basic_diet/data/network/failure.dart';
import 'package:basic_diet/domain/model/subscription_quote_model.dart';
import 'package:basic_diet/domain/repository/repository.dart';
import 'package:basic_diet/domain/usecase/base_usecase.dart';
import 'package:dartz/dartz.dart';

class GetSubscriptionQuoteUseCase
    implements BaseUseCase<SubscriptionQuoteRequestModel, SubscriptionQuoteModel> {
  final Repository _repository;

  GetSubscriptionQuoteUseCase(this._repository);

  @override
  Future<Either<Failure, SubscriptionQuoteModel>> execute(
    SubscriptionQuoteRequestModel input,
  ) async {
    return await _repository.getSubscriptionQuote(input);
  }
}
