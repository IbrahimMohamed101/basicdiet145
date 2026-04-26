import 'package:basic_diet/app/extensions.dart';
import 'package:basic_diet/data/response/addons_response.dart';
import 'package:basic_diet/domain/model/add_ons_model.dart';

extension AddOnsResponseMapper on AddOnsResponse? {
  AddOnsModel toDomain() {
    return AddOnsModel(
      addOns: (this?.data ?? []).map((e) => e.toDomain()).toList(),
    );
  }
}

extension AddOnResponseMapper on AddOnResponse? {
  AddOnModel toDomain() {
    return AddOnModel(
      id: this?.id.orEmpty() ?? "",
      name: this?.name.orEmpty() ?? "",
      category: this?.category.orEmpty() ?? "",
      description: this?.description.orEmpty() ?? "",
      imageUrl: this?.imageUrl.orEmpty() ?? "",
      currency: this?.currency.orEmpty() ?? "",
      priceHalala: this?.priceHalala.orZero() ?? 0,
      priceSar: this?.priceSar.orZero() ?? 0,
      priceLabel: this?.priceLabel.orEmpty() ?? "",
      type: (this?.kind ?? this?.type).orEmpty(),
      ui:
          this?.ui.toDomain() ??
          const AddOnUiModel(title: "", subtitle: "", ctaLabel: "", badge: ""),
    );
  }
}

extension AddOnUiResponseMapper on AddOnUiResponse? {
  AddOnUiModel toDomain() {
    return AddOnUiModel(
      title: this?.title.orEmpty() ?? "",
      subtitle: this?.subtitle.orEmpty() ?? "",
      ctaLabel: this?.ctaLabel.orEmpty() ?? "",
      badge: this?.badge.orEmpty() ?? "",
    );
  }
}
