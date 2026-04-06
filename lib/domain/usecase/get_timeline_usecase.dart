import 'package:basic_diet/data/network/failure.dart';
import 'package:basic_diet/domain/model/timeline_model.dart';
import 'package:basic_diet/domain/repository/repository.dart';
import 'package:basic_diet/domain/usecase/base_usecase.dart';
import 'package:dartz/dartz.dart';

class GetTimelineUseCase implements BaseUseCase<String, TimelineModel> {
  final Repository _repository;

  GetTimelineUseCase(this._repository);

  @override
  Future<Either<Failure, TimelineModel>> execute(String input) async {
    return await _repository.getSubscriptionTimeline(input);
  }
}
