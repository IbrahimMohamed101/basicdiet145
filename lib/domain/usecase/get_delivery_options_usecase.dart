import 'package:basic_diet/data/network/failure.dart';
import 'package:basic_diet/domain/model/delivery_options_model.dart';
import 'package:basic_diet/domain/repository/repository.dart';
import 'package:basic_diet/domain/usecase/base_usecase.dart';
import 'package:dartz/dartz.dart';

class GetDeliveryOptionsUseCase
    implements BaseUseCase<void, DeliveryOptionsModel> {
  final Repository _repository;

  GetDeliveryOptionsUseCase(this._repository);

  @override
  Future<Either<Failure, DeliveryOptionsModel>> execute(void input) async {
    return await _repository.getDeliveryOptions();
  }
}
