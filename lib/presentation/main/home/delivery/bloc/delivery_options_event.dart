import 'package:basic_diet/domain/model/delivery_options_model.dart';
import 'package:basic_diet/presentation/main/home/delivery/delivery_method_screen.dart';

abstract class DeliveryOptionsEvent {
  const DeliveryOptionsEvent();
}

class GetDeliveryOptionsEvent extends DeliveryOptionsEvent {
  const GetDeliveryOptionsEvent();
}

class ChangeDeliveryTypeEvent extends DeliveryOptionsEvent {
  final DeliveryType deliveryType;
  const ChangeDeliveryTypeEvent(this.deliveryType);
}

class SelectAreaEvent extends DeliveryOptionsEvent {
  final DeliveryAreaModel area;
  const SelectAreaEvent(this.area);
}

class SelectTimeEvent extends DeliveryOptionsEvent {
  final DeliverySlotModel time;
  const SelectTimeEvent(this.time);
}

class SelectStartDateEvent extends DeliveryOptionsEvent {
  final DateTime date;
  const SelectStartDateEvent(this.date);
}

class UpdateAddressFieldsEvent extends DeliveryOptionsEvent {
  final String? street;
  final String? building;
  final String? apartment;
  final String? notes;

  const UpdateAddressFieldsEvent({
    this.street,
    this.building,
    this.apartment,
    this.notes,
  });
}
