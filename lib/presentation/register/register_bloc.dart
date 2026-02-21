import 'package:flutter_bloc/flutter_bloc.dart';
import 'register_event.dart';
import 'register_state.dart';

class RegisterBloc extends Bloc<RegisterEvent, RegisterState> {
  RegisterBloc() : super(const RegisterFormInitialState()) {
    on<RegisterFullNameChanged>(_onFullNameChanged);
    on<RegisterPhoneChanged>(_onPhoneChanged);
    on<RegisterEmailChanged>(_onEmailChanged);
    on<RegisterSubmitted>(_onSubmitted);
  }

  void _onFullNameChanged(
    RegisterFullNameChanged event,
    Emitter<RegisterState> emit,
  ) {
    final error = _validateFullName(event.fullName);
    emit(state.copyWith(fullName: event.fullName, fullNameError: error));
  }

  void _onPhoneChanged(
    RegisterPhoneChanged event,
    Emitter<RegisterState> emit,
  ) {
    final error = _validatePhone(event.phone);
    emit(state.copyWith(phone: event.phone, phoneError: error));
  }

  void _onEmailChanged(
    RegisterEmailChanged event,
    Emitter<RegisterState> emit,
  ) {
    final error = _validateEmail(event.email);
    emit(state.copyWith(email: event.email, emailError: error));
  }

  Future<void> _onSubmitted(
    RegisterSubmitted event,
    Emitter<RegisterState> emit,
  ) async {
    emit(
      RegisterLoadingState(
        fullName: state.fullName,
        phone: state.phone,
        email: state.email,
      ),
    );

    try {
      await Future.delayed(const Duration(seconds: 1));
      emit(
        RegisterSuccessState(
          fullName: state.fullName,
          phone: state.phone,
          email: state.email,
        ),
      );
    } catch (e) {
      emit(
        RegisterErrorState(
          "Something went wrong",
          fullName: state.fullName,
          phone: state.phone,
          email: state.email,
        ),
      );
    }
  }

  String? _validateFullName(String fullName) {
    if (fullName.isEmpty) return "Full name is required";
    return null;
  }

  String? _validatePhone(String phone) {
    if (phone.isEmpty) return "Phone is required";
    if (phone.length < 9) return "Phone is too short";
    return null;
  }

  String? _validateEmail(String email) {
    if (email.isNotEmpty && !email.contains("@")) {
      return "Invalid email";
    }
    return null;
  }
}
