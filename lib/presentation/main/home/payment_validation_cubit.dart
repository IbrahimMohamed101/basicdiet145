import 'package:basic_diet/domain/usecase/get_checkout_draft_usecase.dart';
import 'package:basic_diet/domain/model/checkout_draft_model.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:equatable/equatable.dart';

abstract class PaymentValidationState extends Equatable {
  const PaymentValidationState();
  @override
  List<Object?> get props => [];
}

class PaymentValidationInitial extends PaymentValidationState {}

class PaymentValidationLoading extends PaymentValidationState {}

class PaymentValidationSuccess extends PaymentValidationState {
  final CheckoutDraftModel draftModel;

  const PaymentValidationSuccess(this.draftModel);

  @override
  List<Object?> get props => [draftModel];
}

class PaymentValidationFailure extends PaymentValidationState {
  final String message;

  const PaymentValidationFailure(this.message);

  @override
  List<Object?> get props => [message];
}

class PaymentValidationCubit extends Cubit<PaymentValidationState> {
  final GetCheckoutDraftUseCase _getCheckoutDraftUseCase;

  PaymentValidationCubit(this._getCheckoutDraftUseCase) : super(PaymentValidationInitial());

  void validatePayment(String draftId) async {
    emit(PaymentValidationLoading());
    final result = await _getCheckoutDraftUseCase.execute(draftId);
    result.fold(
      (failure) => emit(PaymentValidationFailure(failure.message)),
      (draftModel) {
        // Here we can check draftModel.checkedProvider or paymentStatusLabel 
        // to decide if it's truly a success.
        if (draftModel.checkedProvider) {
          emit(PaymentValidationSuccess(draftModel));
        } else {
          emit(const PaymentValidationFailure("Payment was not completed successfully."));
        }
      },
    );
  }
}
