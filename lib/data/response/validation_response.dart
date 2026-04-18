import 'package:basic_diet/data/response/subscription_day_response.dart';
import 'package:json_annotation/json_annotation.dart';

part 'validation_response.g.dart';

@JsonSerializable()
class ValidationResponse {
  @JsonKey(name: "valid")
  final bool valid;
  
  @JsonKey(name: "mealSlots")
  final List<MealSlotResponse>? mealSlots;
  
  @JsonKey(name: "plannerMeta")
  final PlannerMetaResponse? plannerMeta;
  
  @JsonKey(name: "paymentRequirement")
  final PaymentRequirementResponse? paymentRequirement;
  
  @JsonKey(name: "slotErrors")
  final List<SlotErrorResponse>? slotErrors;

  ValidationResponse(
    this.valid,
    this.mealSlots,
    this.plannerMeta,
    this.paymentRequirement,
    this.slotErrors,
  );

  factory ValidationResponse.fromJson(Map<String, dynamic> json) =>
      _$ValidationResponseFromJson(json);

  Map<String, dynamic> toJson() => _$ValidationResponseToJson(this);
}

@JsonSerializable()
class SlotErrorResponse {
  @JsonKey(name: "slotIndex")
  final int slotIndex;
  
  @JsonKey(name: "field")
  final String field;
  
  @JsonKey(name: "code")
  final String code;
  
  @JsonKey(name: "message")
  final String message;

  SlotErrorResponse(
    this.slotIndex,
    this.field,
    this.code,
    this.message,
  );

  factory SlotErrorResponse.fromJson(Map<String, dynamic> json) =>
      _$SlotErrorResponseFromJson(json);

  Map<String, dynamic> toJson() => _$SlotErrorResponseToJson(this);
}
