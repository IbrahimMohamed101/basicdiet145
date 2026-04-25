import 'package:json_annotation/json_annotation.dart';

part 'addons_response.g.dart';

@JsonSerializable()
class AddOnsResponse {
  @JsonKey(name: "status")
  dynamic status;
  @JsonKey(name: "message")
  String? message;
  @JsonKey(name: "data")
  List<AddOnResponse>? data;

  AddOnsResponse(this.status, this.message, this.data);

  factory AddOnsResponse.fromJson(Map<String, dynamic> json) =>
      _$AddOnsResponseFromJson(json);

  Map<String, dynamic> toJson() => _$AddOnsResponseToJson(this);
}

@JsonSerializable()
class AddOnResponse {
  @JsonKey(name: "id")
  String? id;

  @JsonKey(name: "name")
  String? name;

  @JsonKey(name: "category")
  String? category;

  @JsonKey(name: "description")
  String? description;

  @JsonKey(name: "imageUrl")
  String? imageUrl;

  @JsonKey(name: "currency")
  String? currency;

  @JsonKey(name: "priceHalala")
  int? priceHalala;

  @JsonKey(name: "priceSar")
  double? priceSar;

  @JsonKey(name: "priceLabel")
  String? priceLabel;

  @JsonKey(name: "type")
  String? type;

  @JsonKey(name: "kind")
  String? kind;

  @JsonKey(name: "ui")
  AddOnUiResponse? ui;

  AddOnResponse(
    this.id,
    this.name,
    this.category,
    this.description,
    this.imageUrl,
    this.currency,
    this.priceHalala,
    this.priceSar,
    this.priceLabel,
    this.type,
    this.kind,
    this.ui,
  );

  factory AddOnResponse.fromJson(Map<String, dynamic> json) =>
      _$AddOnResponseFromJson(json);

  Map<String, dynamic> toJson() => _$AddOnResponseToJson(this);
}

@JsonSerializable()
class AddOnUiResponse {
  @JsonKey(name: "title")
  String? title;

  @JsonKey(name: "subtitle")
  String? subtitle;

  @JsonKey(name: "ctaLabel")
  String? ctaLabel;

  @JsonKey(name: "badge")
  String? badge;

  AddOnUiResponse(this.title, this.subtitle, this.ctaLabel, this.badge);

  factory AddOnUiResponse.fromJson(Map<String, dynamic> json) =>
      _$AddOnUiResponseFromJson(json);

  Map<String, dynamic> toJson() => _$AddOnUiResponseToJson(this);
}
