import 'package:basic_diet/app/constants.dart';

extension ErrorResponseMapper on Map<String, dynamic>? {
  String toDomain() {
    if (this == null) return Constants.empty;

    // Check if there's an errors object with validation messages
    final errors = this!['error'];
    if (errors is Map<String, dynamic> && errors.isNotEmpty) {
      return errors.values.first.toString();
    }

    // Fallback to the message field
    return this!['message']?.toString() ?? Constants.empty;
  }
}
