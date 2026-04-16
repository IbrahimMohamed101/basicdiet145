import 'package:basic_diet/domain/usecase/get_meal_planner_menu_usecase.dart';
import 'package:basic_diet/domain/usecase/save_meal_planner_changes_usecase.dart';
import 'package:basic_diet/domain/model/meal_planner_menu_model.dart';
import 'package:basic_diet/domain/model/timeline_model.dart';
import 'package:basic_diet/data/request/bulk_selections_request.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'meal_planner_event.dart';
import 'meal_planner_state.dart';

class MealPlannerBloc extends Bloc<MealPlannerEvent, MealPlannerState> {
  final GetMealPlannerMenuUseCase _getMealPlannerMenuUseCase;
  final SaveMealPlannerChangesUseCase _saveMealPlannerChangesUseCase;
  final List<TimelineDayModel> initialTimelineDays;
  final int initialDayIndex;
  final int premiumMealsRemaining;
  final String subscriptionId;

  MealPlannerBloc(
    this._getMealPlannerMenuUseCase,
    this._saveMealPlannerChangesUseCase, {
    required this.initialTimelineDays,
    required this.initialDayIndex,
    required this.premiumMealsRemaining,
    required this.subscriptionId,
  }) : super(MealPlannerInitial()) {
    on<GetMealPlannerDataEvent>(_onGetData);
    on<ChangeDateEvent>(_onChangeDate);
    on<SetMealSlotProteinEvent>(_onSetProtein);
    on<SetMealSlotCarbEvent>(_onSetCarb);
    on<SaveMealPlannerChangesEvent>(_onSave);
    on<HideBannerEvent>(_onHideBanner);
  }

  Future<void> _onGetData(
    GetMealPlannerDataEvent event,
    Emitter<MealPlannerState> emit,
  ) async {
    emit(MealPlannerLoading());
    final menuResult = await _getMealPlannerMenuUseCase.execute(null);

    menuResult.fold(
      (failure) => emit(MealPlannerError("${failure.code}: ${failure.message}")),
      (menu) {
        final slotsByDay = <int, List<MealPlannerSlotSelection>>{};
        final savedSlotsByDay = <int, List<MealPlannerSlotSelection>>{};

        for (int dayIndex = 0; dayIndex < initialTimelineDays.length; dayIndex++) {
          final day = initialTimelineDays[dayIndex];
          final requiredSlots = day.requiredMeals;
          final selections = [
            ...day.selections,
            ...day.premiumSelections,
          ];

          final slots = List<MealPlannerSlotSelection>.generate(
            requiredSlots,
            (slotIndex) {
              final proteinId = slotIndex < selections.length ? selections[slotIndex] : null;
              return MealPlannerSlotSelection(
                proteinId: proteinId,
                carbId: null,
              );
            },
          );

          slotsByDay[dayIndex] = slots;
          savedSlotsByDay[dayIndex] = List<MealPlannerSlotSelection>.from(slots);
        }

        emit(
          MealPlannerLoaded(
            timelineDays: initialTimelineDays,
            menu: menu,
            selectedDayIndex: initialDayIndex,
            selectedSlotsPerDay: slotsByDay,
            savedSlotsPerDay: savedSlotsByDay,
            premiumMealsRemaining: premiumMealsRemaining,
          ),
        );
      },
    );
  }

  void _onChangeDate(ChangeDateEvent event, Emitter<MealPlannerState> emit) {
    if (state is MealPlannerLoaded) {
      final s = state as MealPlannerLoaded;
      emit(s.copyWith(selectedDayIndex: event.index));
    }
  }

  void _onSetProtein(
    SetMealSlotProteinEvent event,
    Emitter<MealPlannerState> emit,
  ) {
    if (state is! MealPlannerLoaded) return;
    final s = state as MealPlannerLoaded;
    final dayIndex = s.selectedDayIndex;
    final slots = List<MealPlannerSlotSelection>.from(
      s.selectedSlotsPerDay[dayIndex] ?? const [],
    );
    if (event.slotIndex < 0 || event.slotIndex >= slots.length) return;

    final current = slots[event.slotIndex];
    if (current.proteinId == event.proteinId) return;

    final next = current.copyWith(
      proteinId: event.proteinId,
      carbId: event.proteinId == null ? null : current.carbId,
    );
    slots[event.slotIndex] = next;

    final updated = Map<int, List<MealPlannerSlotSelection>>.from(
      s.selectedSlotsPerDay,
    )..[dayIndex] = slots;

    String proteinName = '';
    if (event.proteinId != null) {
      final protein = _findProteinById(s.menu, event.proteinId!);
      proteinName = protein?.name ?? '';
    }

    emit(
      s.copyWith(
        selectedSlotsPerDay: updated,
        showSavedBanner: event.proteinId != null,
        lastAddedMealName:
            proteinName.isNotEmpty ? proteinName : s.lastAddedMealName,
      ),
    );
  }

  void _onSetCarb(
    SetMealSlotCarbEvent event,
    Emitter<MealPlannerState> emit,
  ) {
    if (state is! MealPlannerLoaded) return;
    final s = state as MealPlannerLoaded;
    final dayIndex = s.selectedDayIndex;
    final slots = List<MealPlannerSlotSelection>.from(
      s.selectedSlotsPerDay[dayIndex] ?? const [],
    );
    if (event.slotIndex < 0 || event.slotIndex >= slots.length) return;

    final current = slots[event.slotIndex];
    if (current.carbId == event.carbId) return;

    slots[event.slotIndex] = current.copyWith(carbId: event.carbId);

    final updated = Map<int, List<MealPlannerSlotSelection>>.from(
      s.selectedSlotsPerDay,
    )..[dayIndex] = slots;

    emit(
      s.copyWith(
        selectedSlotsPerDay: updated,
      ),
    );
  }

  void _onHideBanner(HideBannerEvent event, Emitter<MealPlannerState> emit) {
    if (state is MealPlannerLoaded) {
      final s = state as MealPlannerLoaded;
      emit(s.copyWith(showSavedBanner: false));
    }
  }

  Future<void> _onSave(
      SaveMealPlannerChangesEvent event, Emitter<MealPlannerState> emit) async {
    if (state is MealPlannerLoaded) {
      final s = state as MealPlannerLoaded;
      emit(s.copyWith(isSaving: true));

      // 1. Identify completed days
      List<BulkSelectionDayRequest> dayRequests = [];
      for (int i = 0; i < s.timelineDays.length; i++) {
        final day = s.timelineDays[i];
        final slots = s.selectedSlotsPerDay[i] ?? [];
        final proteinSelections = slots
            .where((e) => e.proteinId != null && e.carbId != null)
            .map((e) => e.proteinId!)
            .toList();

        if (proteinSelections.length >= day.requiredMeals) {
          // This day is completed, we will send it.
          List<String> normalSelections = [];
          List<String> premiumSelections = [];

          for (final proteinId in proteinSelections) {
            final protein = _findProteinById(s.menu, proteinId);
            final isPremium = protein?.isPremium ?? false;
            if (isPremium) {
              premiumSelections.add(proteinId);
            } else {
              normalSelections.add(proteinId);
            }
          }

          dayRequests.add(BulkSelectionDayRequest(
            date: day.date,
            selections: normalSelections,
            premiumSelections: premiumSelections,
            addonsOneTime: [],
          ));
        }
      }

      if (dayRequests.isEmpty) {
        // Nothing to save
        emit(s.copyWith(isSaving: false));
        return;
      }

      final request = BulkSelectionsRequest(days: dayRequests);
      final result = await _saveMealPlannerChangesUseCase.execute(
        SaveMealPlannerChangesUseCaseInput(subscriptionId, request),
      );

      result.fold(
        (failure) {
          // You might want to handle error differently (e.g. show toast)
          // For now, let's just stop loading.
          emit(s.copyWith(isSaving: false));
        },
        (success) {
          emit(s.copyWith(
            isSaving: false,
            saveSuccess: true,
            savedSlotsPerDay: Map<int, List<MealPlannerSlotSelection>>.from(
              s.selectedSlotsPerDay,
            ),
          ));
        },
      );
    }
  }

  BuilderProteinModel? _findProteinById(MealPlannerMenuModel menu, String id) {
    for (final protein in menu.builderCatalog.proteins) {
      if (protein.id == id) return protein;
    }
    return null;
  }
}
