import 'package:basic_diet/domain/model/add_ons_model.dart';
import 'package:equatable/equatable.dart';

abstract class AddOnsState extends Equatable {
  const AddOnsState();

  @override
  List<Object?> get props => [];
}

class AddOnsInitial extends AddOnsState {
  const AddOnsInitial();
}

class AddOnsLoading extends AddOnsState {
  const AddOnsLoading();
}

class AddOnsSuccess extends AddOnsState {
  final AddOnsModel addOnsModel;
  final Set<AddOnModel> selectedAddOns;

  const AddOnsSuccess(this.addOnsModel, {this.selectedAddOns = const {}});

  AddOnsSuccess copyWith({
    AddOnsModel? addOnsModel,
    Set<AddOnModel>? selectedAddOns,
  }) {
    return AddOnsSuccess(
      addOnsModel ?? this.addOnsModel,
      selectedAddOns: selectedAddOns ?? this.selectedAddOns,
    );
  }

  @override
  List<Object?> get props => [addOnsModel, selectedAddOns];
}

class AddOnsError extends AddOnsState {
  final String message;
  const AddOnsError(this.message);

  @override
  List<Object?> get props => [message];
}
