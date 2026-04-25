import 'package:basic_diet/data/network/failure.dart';
import 'package:basic_diet/domain/model/current_subscription_overview_model.dart';
import 'package:basic_diet/domain/repository/repository.dart';
import 'package:basic_diet/domain/usecase/base_usecase.dart';
import 'package:dartz/dartz.dart';

class GetCurrentSubscriptionOverviewUseCase
    implements BaseUseCase<void, CurrentSubscriptionOverviewModel> {
  final Repository _repository;

  GetCurrentSubscriptionOverviewUseCase(this._repository);

  @override
  Future<Either<Failure, CurrentSubscriptionOverviewModel>> execute(
    void input,
  ) {
    return _repository.getCurrentSubscriptionOverview();
  }
}
