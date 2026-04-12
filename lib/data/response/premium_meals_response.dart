import 'package:json_annotation/json_annotation.dart';

part 'premium_meals_response.g.dart';

@JsonSerializable()
class PremiumMealsResponse {
  @JsonKey(name: "status")
  dynamic status;
  @JsonKey(name: "data")
  List<PremiumMealResponse>? data;

  PremiumMealsResponse({this.status, this.data});

  factory PremiumMealsResponse.fromJson(Map<String, dynamic> json) =>
      _$PremiumMealsResponseFromJson(json);

  Map<String, dynamic> toJson() => _$PremiumMealsResponseToJson(this);
}

@JsonSerializable()
class PremiumMealResponse {
  @JsonKey(name: "id")
  String? id;
  @JsonKey(name: "name")
  String? name;
  @JsonKey(name: "description")
  String? description;
  @JsonKey(name: "imageUrl")
  String? imageUrl;
  @JsonKey(name: "currency")
  String? currency;
  @JsonKey(name: "extraFeeHalala")
  int? extraFeeHalala;
  @JsonKey(name: "extraFeeSar")
  double? extraFeeSar;
  @JsonKey(name: "priceHalala")
  int? priceHalala;
  @JsonKey(name: "priceSar")
  double? priceSar;
  @JsonKey(name: "priceLabel")
  String? priceLabel;
  @JsonKey(name: "ui")
  PremiumMealUiResponse? ui;

  PremiumMealResponse({
    this.id,
    this.name,
    this.description,
    this.imageUrl,
    this.currency,
    this.extraFeeHalala,
    this.extraFeeSar,
    this.priceHalala,
    this.priceSar,
    this.priceLabel,
    this.ui,
  });

  factory PremiumMealResponse.fromJson(Map<String, dynamic> json) =>
      _$PremiumMealResponseFromJson(json);

  Map<String, dynamic> toJson() => _$PremiumMealResponseToJson(this);
}

@JsonSerializable()
class PremiumMealUiResponse {
  @JsonKey(name: "title")
  String? title;
  @JsonKey(name: "subtitle")
  String? subtitle;
  @JsonKey(name: "ctaLabel")
  String? ctaLabel;
  @JsonKey(name: "selectionStyle")
  String? selectionStyle;

  PremiumMealUiResponse({
    this.title,
    this.subtitle,
    this.ctaLabel,
    this.selectionStyle,
  });

  factory PremiumMealUiResponse.fromJson(Map<String, dynamic> json) =>
      _$PremiumMealUiResponseFromJson(json);

  Map<String, dynamic> toJson() => _$PremiumMealUiResponseToJson(this);
}
