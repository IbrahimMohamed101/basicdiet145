import 'package:json_annotation/json_annotation.dart';

part 'plans_response.g.dart';

@JsonSerializable()
class PlansResponse {
  @JsonKey(name: "status")
  dynamic status;
  @JsonKey(name: "data")
  List<PlanResponse>? data;

  PlansResponse({this.status, this.data});

  factory PlansResponse.fromJson(Map<String, dynamic> json) =>
      _$PlansResponseFromJson(json);

  Map<String, dynamic> toJson() => _$PlansResponseToJson(this);
}

@JsonSerializable()
class PlanResponse {
  @JsonKey(name: "id")
  String? id;
  @JsonKey(name: "name")
  String? name;
  @JsonKey(name: "daysCount")
  int? daysCount;
  @JsonKey(name: "currency")
  String? currency;
  @JsonKey(name: "isActive")
  bool? isActive;
  @JsonKey(name: "gramsOptions")
  List<GramOptionResponse>? gramsOptions;

  PlanResponse({
    this.id,
    this.name,
    this.daysCount,
    this.currency,
    this.isActive,
    this.gramsOptions,
  });

  factory PlanResponse.fromJson(Map<String, dynamic> json) =>
      _$PlanResponseFromJson(json);

  Map<String, dynamic> toJson() => _$PlanResponseToJson(this);
}

@JsonSerializable()
class GramOptionResponse {
  @JsonKey(name: "grams")
  int? grams;
  @JsonKey(name: "mealsOptions")
  List<MealOptionResponse>? mealsOptions;

  GramOptionResponse({this.grams, this.mealsOptions});

  factory GramOptionResponse.fromJson(Map<String, dynamic> json) =>
      _$GramOptionResponseFromJson(json);

  Map<String, dynamic> toJson() => _$GramOptionResponseToJson(this);
}

@JsonSerializable()
class MealOptionResponse {
  @JsonKey(name: "mealsPerDay")
  int? mealsPerDay;
  @JsonKey(name: "priceSar")
  double? priceSar;
  @JsonKey(name: "compareAtSar")
  double? compareAtSar;

  MealOptionResponse({this.mealsPerDay, this.priceSar, this.compareAtSar});

  factory MealOptionResponse.fromJson(Map<String, dynamic> json) =>
      _$MealOptionResponseFromJson(json);

  Map<String, dynamic> toJson() => _$MealOptionResponseToJson(this);
}
