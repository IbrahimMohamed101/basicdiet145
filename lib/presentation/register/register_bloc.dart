import 'package:basic_diet/app/toast_handeller.dart';
import 'package:basic_diet/domain/usecase/register_usecase.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'register_event.dart';
import 'register_state.dart';

class RegisterBloc extends Bloc<RegisterEvent, RegisterState> {
  final RegisterUseCase _registerUseCase;

  RegisterBloc(this._registerUseCase)
    : super(const RegisterFormInitialState()) {
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

    final result = await _registerUseCase.execute(
      RegisterUseCaseInput(
        state.fullName,
        state.phone,
        state.email.isEmpty ? null : state.email,
      ),
    );

    result.fold(
      (failure) {
        emit(
          RegisterErrorState(
            failure.message,
            fullName: state.fullName,
            phone: state.phone,
            email: state.email,
          ),
        );
        showToast(message: failure.message, state: ToastStates.error);
      },
      (baseModel) {
        final message = baseModel.message ?? "OTP sent successfully";
        emit(
          RegisterSuccessState(
            message,
            fullName: state.fullName,
            phone: state.phone,
            email: state.email,
          ),
        );
        showToast(message: message, state: ToastStates.success);
      },
    );
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
