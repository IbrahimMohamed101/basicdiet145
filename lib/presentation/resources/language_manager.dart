import 'dart:ui';

enum LanguageType { english, arabic }

const String english = "en";
const String arabic = "ar";

const String assetPathLocalization = "assets/translations";
const Locale englishLocale = Locale(english, "US");
const Locale arabicLocale = Locale(arabic, "SA");

extension LanguageTypeExtension on LanguageType {
  String getValue() => this == LanguageType.english ? english : arabic;
}
