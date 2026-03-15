import 'dart:async';
import 'package:basic_diet/app/app_pref.dart';
import 'package:basic_diet/app/toast_handeller.dart';
import 'package:basic_diet/domain/usecase/verify_otp_usecase.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'verify_event.dart';
import 'verify_state.dart';

class VerifyBloc extends Bloc<VerifyEvent, VerifyState> {
  final VerifyOtpUseCase _verifyOtpUseCase;
  final AppPreferences _appPreferences;
  Timer? _timer;
  static const int _timerDuration = 5;

  VerifyBloc(this._verifyOtpUseCase, this._appPreferences)
    : super(const VerifyInitialState()) {
    on<VerifyCodeChanged>(_onCodeChanged);
    on<VerifySubmitted>(_onSubmitted);
    on<VerifyResendCode>(_onResendCode);
    on<VerifyTimerStarted>(_onTimerStarted);
    on<VerifyTimerTicked>(_onTimerTicked);
    add(const VerifyTimerStarted());
  }

  void _onTimerStarted(VerifyTimerStarted event, Emitter<VerifyState> emit) {
    _timer?.cancel();
    emit(state.copyWith(timerDuration: _timerDuration, canResend: false));
    _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
      add(VerifyTimerTicked(_timerDuration - timer.tick));
    });
  }

  void _onTimerTicked(VerifyTimerTicked event, Emitter<VerifyState> emit) {
    if (event.duration > 0) {
      emit(state.copyWith(timerDuration: event.duration));
    } else {
      _timer?.cancel();
      emit(state.copyWith(timerDuration: 0, canResend: true));
    }
  }

  void _onCodeChanged(VerifyCodeChanged event, Emitter<VerifyState> emit) {
    final error = _validateCode(event.code);
    emit(state.copyWith(otpCode: event.code, otpError: error));
  }

  Future<void> _onSubmitted(
    VerifySubmitted event,
    Emitter<VerifyState> emit,
  ) async {
    emit(
      VerifyLoadingState(
        otpCode: state.otpCode,
        timerDuration: state.timerDuration,
        canResend: state.canResend,
      ),
    );

    final result = await _verifyOtpUseCase.execute(
      VerifyOtpUseCaseInput(event.phone, state.otpCode),
    );

    await result.fold(
      (failure) async {
        showToast(message: failure.message, state: ToastStates.error);
        emit(
          VerifyErrorState(
            failure.message,
            otpCode: state.otpCode,
            timerDuration: state.timerDuration,
            canResend: state.canResend,
          ),
        );
      },
      (data) async {
        // Store token
        if (data.token != null && data.token!.isNotEmpty) {
          await _appPreferences.setUserToken("login", data.token!);
          showToast(message: "Success Otp", state: ToastStates.success);
          emit(
            VerifySuccessState(
              otpCode: state.otpCode,
              timerDuration: state.timerDuration,
              canResend: state.canResend,
            ),
          );
        } else {
          emit(
            VerifyErrorState(
              "Token not found",
              otpCode: state.otpCode,
              timerDuration: state.timerDuration,
              canResend: state.canResend,
            ),
          );
        }
      },
    );
  }

  Future<void> _onResendCode(
    VerifyResendCode event,
    Emitter<VerifyState> emit,
  ) async {
    // Only allow resend if it's enabled
    if (!state.canResend) return;

    // Restart timer
    add(const VerifyTimerStarted());

    // Logic to actually resend code would go here
  }

  String? _validateCode(String code) {
    if (code.isEmpty) return "Code is required";
    if (code.length < 6) return "Code must be 6 digits";
    return null;
  }

  @override
  Future<void> close() {
    _timer?.cancel();
    return super.close();
  }
}
