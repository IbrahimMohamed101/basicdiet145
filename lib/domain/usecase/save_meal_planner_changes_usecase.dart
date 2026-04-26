import 'package:basic_diet/data/network/failure.dart';
import 'package:basic_diet/data/request/bulk_selections_request.dart';
import 'package:basic_diet/domain/model/bulk_selections_model.dart';
import 'package:basic_diet/domain/repository/repository.dart';
import 'package:basic_diet/domain/usecase/base_usecase.dart';
import 'package:dartz/dartz.dart';

class SaveMealPlannerChangesUseCaseInput {
  final String subscriptionId;
  final BulkSelectionsRequest request;

  SaveMealPlannerChangesUseCaseInput(this.subscriptionId, this.request);
}

class SaveMealPlannerChangesUseCase
    implements
        BaseUseCase<SaveMealPlannerChangesUseCaseInput, BulkSelectionsModel> {
  final Repository _repository;

  SaveMealPlannerChangesUseCase(this._repository);

  @override
  Future<Either<Failure, BulkSelectionsModel>> execute(
    SaveMealPlannerChangesUseCaseInput input,
  ) async {
    return await _repository.bulkSelections(
      input.subscriptionId,
      input.request,
    );
  }
}
