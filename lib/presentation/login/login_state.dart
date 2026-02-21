import 'package:equatable/equatable.dart';

// The login_state.dart file defines "What the UI should look like" right now.
// Unlike events (which are momentary actions أفعال لحظية), states are persistent snapshots.
// The UI listens to these states to know what to draw on the screen.

// Purpose: It holds the "data" that might be present in multiple states, specifically validation errors.
// Why: By having these fields in the base class, any state could potentially carry separate error messages for fields,
// though it's mostly used by specific subclasses here.
abstract class LoginState extends Equatable {
  final String phone;
  final String? phoneError;

  const LoginState({this.phone = '', this.phoneError});

  LoginState copyWith({String? phone, String? phoneError});

  @override
  List<Object?> get props => [phone, phoneError ?? ''];
}

// Meaning: The screen just opened.
// UI Reaction: Show the empty form. No spinners, no error messages.
class LoginFormInitialState extends LoginState {
  const LoginFormInitialState({super.phone = '', super.phoneError});

  @override
  LoginState copyWith({String? phone, String? phoneError}) {
    return LoginFormInitialState(
      phone: phone ?? this.phone,
      phoneError: phoneError,
    );
  }
}

// Meaning: The user pressed "Login", and the app is currently talking to the server.
// UI Reaction:
//   Disable the Login button so the user doesn't click it twice.
//   Show a CircularProgressIndicator (spinner).
class LoginLoading extends LoginState {
  const LoginLoading({super.phone = '', super.phoneError});

  @override
  LoginState copyWith({String? phone, String? phoneError}) {
    return LoginLoading(phone: phone ?? this.phone, phoneError: phoneError);
  }
}

// Meaning: The server returned a 200 OK. The user is authenticated.
// UI Reaction: Navigate away from this screen (e.g., Navigator.pushReplacementNamed('/home')).
class LoginSuccess extends LoginState {
  const LoginSuccess({super.phone = '', super.phoneError});

  @override
  LoginState copyWith({String? phone, String? phoneError}) {
    return LoginSuccess(phone: phone ?? this.phone, phoneError: phoneError);
  }
}

// Meaning: The request was sent, but something went wrong. Could be "No Internet", "Server Down", or "Wrong Password" returned by the API.
// UI Reaction: Show a Snackbar or a global error message telling the user what went wrong (e.g., "Connection Timeout").
class LoginError extends LoginState {
  final String message;
  const LoginError(this.message, {super.phone = '', super.phoneError});

  @override
  LoginState copyWith({String? phone, String? phoneError}) {
    return LoginError(
      message,
      phone: phone ?? this.phone,
      phoneError: phoneError,
    );
  }

  @override
  List<Object?> get props => [phone, phoneError ?? '', message];
}

/*

What does "immutable غير قابل للتغيير" mean? The object cannot be changed after it is created. Once created → its values stay fixed forever.
Real Life Example: Imagine you print a passport. After printing You cannot change the name inside it. If you need a new name → you must print a new passport. That passport is immutable.

class User {
  final String name;
  const User(this.name);
}

User user = User("Ali");
user.name = "Omar"; // ❌ ERROR

================================================================================================================================================================

What is mutable قابل للتغيير in Dart? The object can be changed after it is created. Once created → its values can be changed.
Real Life Example: Imagine a whiteboard. You can write on it. You can erase what you wrote. You can write again. That whiteboard is mutable.

class User {
  String name;
  User(this.name);
}

void main() {
  User user = User("Ali");
  user.name = "Omar"; // ✅ allowed
}

================================================================================================================================================================
Why does BLoC require immutability? BLoC depends on oldState != newState. If you mutate the same object → it may think nothing changed. This is why BLoC requires immutability.

class LoginState {
  String phone;
  LoginState(this.phone);
}

Now inside BLoC:

state.phone = "123";
emit(state);

🚨 Problem:

You didn’t create a new state.
You changed the old one.

Flutter may NOT rebuild.
Debugging becomes a nightmare.

Because: The reference didn’t change — only the value changed.

But when use emit(state.copyWith(phone: "999"));
Old object ≠ New object
Flutter rebuilds safely ✅
*/
