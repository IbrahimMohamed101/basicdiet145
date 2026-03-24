import 'package:basic_diet/domain/usecase/get_addons_usecase.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'add_ons_event.dart';
import 'add_ons_state.dart';

class AddOnsBloc extends Bloc<AddOnsEvent, AddOnsState> {
  final GetAddOnsUseCase _getAddOnsUseCase;

  AddOnsBloc(this._getAddOnsUseCase) : super(const AddOnsInitial()) {
    on<GetAddOnsEvent>(_onGetAddOns);
    on<ToggleAddOnSelectionEvent>(_onToggleSelection);
  }

  Future<void> _onGetAddOns(
    GetAddOnsEvent event,
    Emitter<AddOnsState> emit,
  ) async {
    emit(const AddOnsLoading());
    final result = await _getAddOnsUseCase.execute(null);
    result.fold(
      (failure) => emit(AddOnsError(failure.message)),
      (addOnsModel) => emit(AddOnsSuccess(addOnsModel)),
    );
  }

  void _onToggleSelection(
    ToggleAddOnSelectionEvent event,
    Emitter<AddOnsState> emit,
  ) {
    if (state is AddOnsSuccess) {
      final successState = state as AddOnsSuccess;
      final selected = Set.of(successState.selectedAddOns);
      if (selected.contains(event.addOn)) {
        selected.remove(event.addOn);
      } else {
        selected.add(event.addOn);
      }
      emit(successState.copyWith(selectedAddOns: selected));
    }
  }
}
