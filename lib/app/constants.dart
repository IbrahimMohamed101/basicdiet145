import 'package:flutter_dotenv/flutter_dotenv.dart';

class Constants {
  static const String empty = "";
  static const int zero = 0;
  static const double decimalZero = 0.0;
  static const bool falseValue = false;
  static const bool isDebug = false;
  static const int timeout = 60 * 1000;
  static String get baseUrl => dotenv.env['BASE_URL']!;
}
