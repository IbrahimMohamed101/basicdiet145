import 'package:equatable/equatable.dart';

// In the BLoC pattern, the login_event.dart file defines "What happened?" from the user's perspective.
// It represents the inputs to the BLoC.

// Purpose: This is a base class that all other events must inherit from.
// Equatable: It extends Equatable so that the BLoC can compare two events.
// If the user clicks the "Login" button twice with the exact same data, Equatable helps the BLoC avoid unnecessary processing
// if it's already handling that exact request.
abstract class LoginEvent extends Equatable {
  const LoginEvent();

  @override
  List<Object?> get props => [];
}

// Trigger: This event is fired every time the user types a character in the phone text field.
// Data carried: It carries the current string inside the text field (phone).
// Why: The BLoC needs this to perform real-time validation (e.g., checking if the field is empty to enable/disable the login button).
class LoginPhoneChanged extends LoginEvent {
  final String phone;
  const LoginPhoneChanged(this.phone);

  @override
  List<Object?> get props => [phone];
}

// Trigger: This event is fired when the user clicks the "Login" button.
// Data carried: It carries the current state of the form (phone number and any validation errors).
// Why: The BLoC needs this to perform the final login action (e.g., sending the data to the server).
class LoginSubmitted extends LoginEvent {
  const LoginSubmitted();
}
