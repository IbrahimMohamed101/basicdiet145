import 'package:equatable/equatable.dart';

class AddOnsModel extends Equatable {
  final List<AddOnModel> addOns;

  const AddOnsModel({required this.addOns});

  @override
  List<Object?> get props => [addOns];
}

class AddOnModel extends Equatable {
  final String id;
  final String name;
  final String category;
  final String description;
  final String imageUrl;
  final String currency;
  final int priceHalala;
  final double priceSar;
  final String priceLabel;
  final String type;
  final AddOnUiModel ui;

  const AddOnModel({
    required this.id,
    required this.name,
    required this.category,
    required this.description,
    required this.imageUrl,
    required this.currency,
    required this.priceHalala,
    required this.priceSar,
    required this.priceLabel,
    required this.type,
    required this.ui,
  });

  String get kind => type;

  @override
  List<Object?> get props => [
    id,
    name,
    category,
    description,
    imageUrl,
    currency,
    priceHalala,
    priceSar,
    priceLabel,
    type,
    ui,
  ];
}

class AddOnUiModel extends Equatable {
  final String title;
  final String subtitle;
  final String ctaLabel;
  final String badge;

  const AddOnUiModel({
    required this.title,
    required this.subtitle,
    required this.ctaLabel,
    required this.badge,
  });

  @override
  List<Object?> get props => [title, subtitle, ctaLabel, badge];
}
