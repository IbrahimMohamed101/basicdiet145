import 'package:json_annotation/json_annotation.dart';

part 'popular_packages_response.g.dart';

@JsonSerializable()
class PopularPackagesResponse {
  @JsonKey(name: "status")
  dynamic status;
  @JsonKey(name: "data")
  List<PopularPackageResponse>? data;

  PopularPackagesResponse({this.status, this.data});

  factory PopularPackagesResponse.fromJson(Map<String, dynamic> json) =>
      _$PopularPackagesResponseFromJson(json);

  Map<String, dynamic> toJson() => _$PopularPackagesResponseToJson(this);
}

@JsonSerializable()
class PopularPackageResponse {
  @JsonKey(name: "id")
  String? id;
  @JsonKey(name: "planId")
  String? planId;
  @JsonKey(name: "name")
  String? name;
  @JsonKey(name: "daysCount")
  int? daysCount;
  @JsonKey(name: "mealsPerDay")
  int? mealsPerDay;
  @JsonKey(name: "grams")
  int? grams;
  @JsonKey(name: "oldPrice")
  double? oldPrice;
  @JsonKey(name: "newPrice")
  double? newPrice;
  @JsonKey(name: "moneySave")
  double? moneySave;
  @JsonKey(name: "currency")
  String? currency;

  PopularPackageResponse({
    this.id,
    this.planId,
    this.name,
    this.daysCount,
    this.mealsPerDay,
    this.grams,
    this.oldPrice,
    this.newPrice,
    this.moneySave,
    this.currency,
  });

  factory PopularPackageResponse.fromJson(Map<String, dynamic> json) =>
      _$PopularPackageResponseFromJson(json);

  Map<String, dynamic> toJson() => _$PopularPackageResponseToJson(this);
}
