import 'package:equatable/equatable.dart';

class CheckoutDraftModel extends Equatable {
  final String? subscriptionId;
  final String draftId;
  final String paymentId;
  final String paymentUrl;
  final String invoiceId;
  final String checkoutStatusLabel;
  final String paymentStatusLabel;
  final bool checkedProvider;

  const CheckoutDraftModel({
    required this.subscriptionId,
    required this.draftId,
    required this.paymentId,
    required this.paymentUrl,
    required this.invoiceId,
    required this.checkoutStatusLabel,
    required this.paymentStatusLabel,
    required this.checkedProvider,
  });

  @override
  List<Object?> get props => [
    subscriptionId,
    draftId,
    paymentId,
    paymentUrl,
    invoiceId,
    checkoutStatusLabel,
    paymentStatusLabel,
    checkedProvider,
  ];
}
