import 'package:basic_diet/domain/model/add_ons_model.dart';
import 'package:equatable/equatable.dart';

abstract class AddOnsEvent extends Equatable {
  const AddOnsEvent();

  @override
  List<Object> get props => [];
}

class GetAddOnsEvent extends AddOnsEvent {
  const GetAddOnsEvent();
}

class ToggleAddOnSelectionEvent extends AddOnsEvent {
  final AddOnModel addOn;

  const ToggleAddOnSelectionEvent(this.addOn);

  @override
  List<Object> get props => [addOn];
}
