import 'package:basic_diet/app/constants.dart';

extension ErrorResponseMapper on Map<String, dynamic>? {
  String toDomain() {
    if (this == null) return Constants.empty;

    // Check if there's an error object or validation messages
    final errorData = this!['error'];
    if (errorData is Map<String, dynamic> && errorData.isNotEmpty) {
      if (errorData.containsKey('message')) {
        return errorData['message'].toString();
      }
      return errorData.values.first.toString();
    }

    // Fallback to the message field
    return this!['message']?.toString() ?? Constants.empty;
  }
}
