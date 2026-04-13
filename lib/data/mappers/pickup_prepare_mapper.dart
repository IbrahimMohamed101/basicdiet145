import 'package:basic_diet/data/response/pickup_prepare_response.dart';
import 'package:basic_diet/domain/model/pickup_prepare_model.dart';
import 'package:basic_diet/app/extensions.dart';

extension PickupPrepareResponseMapper on PickupPrepareResponse? {
  PickupPrepareModel toDomain() {
    return PickupPrepareModel(
      this?.status.orFalse() ?? false,
      this?.data.toDomain(),
    );
  }
}

extension PickupPrepareDataResponseMapper on PickupPrepareDataResponse? {
  PickupPrepareDataModel toDomain() {
    return PickupPrepareDataModel(
      this?.subscriptionId.orEmpty() ?? "",
      this?.date.orEmpty() ?? "",
      this?.currentStep.orZero() ?? 0,
      this?.status.orEmpty() ?? "",
      this?.statusLabel.orEmpty() ?? "",
      this?.message.orEmpty() ?? "",
      this?.pickupRequested.orFalse() ?? false,
      this?.nextAction.orEmpty() ?? "",
    );
  }
}
