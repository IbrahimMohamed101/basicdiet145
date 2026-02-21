import 'package:flutter_bloc/flutter_bloc.dart';
import 'login_event.dart';
import 'login_state.dart';

// The LoginBloc is the Main Logic Center (The Kitchen).
// It sits between your UI (The customer ordering food) and your Data (The pantry/suppliers).

// It extends Bloc
// You must define:
//    Input: LoginEvent (What comes in?)
//    Output: LoginState (What goes out?)

class LoginBloc extends Bloc<LoginEvent, LoginState> {
  // 1. Constructor & Initial State
  // We pass the initial state to the superclass.
  // We start with LoginFormInitialState because the screen should initially show an empty form.
  LoginBloc() : super(const LoginFormInitialState()) {
    // 2. Event Handlers (The "Recipes")
    // We register "Listeners" for each event.
    // "When you see LoginPhoneChanged, run this function..."
    on<LoginPhoneChanged>(_onPhoneChanged);
    // "When you see LoginSubmitted, run this function..."
    on<LoginSubmitted>(_onSubmitted);
  }

  // _onPhoneChanged is called whenever the user changes the phone input and a LoginPhoneChanged event is added to the Bloc. context.read<LoginBloc>().add(LoginPhoneChanged(phone));
  //
  void _onPhoneChanged(LoginPhoneChanged event, Emitter<LoginState> emit) {
    final error = _validatePhone(event.phone);
    // what is emit? emit is a function that is called to emit a new state إصدار حالة جديدة.
    // what is state.copyWith? state.copyWith is a function that is called to create a new state with the same values as the old state but with the new values.
    emit(state.copyWith(phone: event.phone, phoneError: error));
  }

  Future<void> _onSubmitted(
    LoginSubmitted event,
    Emitter<LoginState> emit,
  ) async {
    // final error = _validatePhone(state.phone);
    // if (error != null) {
    //   emit(state.copyWith(phoneError: error));
    //   return;
    // }

    emit(LoginLoadingState(phone: state.phone));

    try {
      await Future.delayed(const Duration(seconds: 1));
      emit(LoginSuccessState(phone: state.phone));
    } catch (e) {
      emit(LoginErrorState("Something went wrong", phone: state.phone));
    }
  }

  String? _validatePhone(String phone) {
    if (phone.isEmpty) return "Phone is required";
    if (phone.length < 9) return "Phone is too short";
    return null;
  }
}
