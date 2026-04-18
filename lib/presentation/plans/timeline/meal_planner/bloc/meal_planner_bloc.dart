import 'package:basic_diet/domain/usecase/get_meal_planner_menu_usecase.dart';
import 'package:basic_diet/domain/usecase/save_day_selection_usecase.dart';
import 'package:basic_diet/domain/usecase/create_premium_payment_usecase.dart';
import 'package:basic_diet/domain/usecase/verify_premium_payment_usecase.dart';
import 'package:basic_diet/domain/usecase/confirm_day_selection_usecase.dart';
import 'package:basic_diet/domain/model/meal_planner_menu_model.dart';
import 'package:basic_diet/domain/model/timeline_model.dart';
import 'package:basic_diet/data/request/day_selection_request.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'meal_planner_event.dart';
import 'meal_planner_state.dart';

class MealPlannerBloc extends Bloc<MealPlannerEvent, MealPlannerState> {
  final GetMealPlannerMenuUseCase _getMealPlannerMenuUseCase;
  final SaveDaySelectionUseCase _saveDaySelectionUseCase;
  final CreatePremiumPaymentUseCase _createPremiumPaymentUseCase;
  final VerifyPremiumPaymentUseCase _verifyPremiumPaymentUseCase;
  final ConfirmDaySelectionUseCase _confirmDaySelectionUseCase;
  final List<TimelineDayModel> initialTimelineDays;
  final int initialDayIndex;
  final int premiumMealsRemaining;
  final String subscriptionId;

  MealPlannerBloc(
    this._getMealPlannerMenuUseCase,
    this._saveDaySelectionUseCase,
    this._createPremiumPaymentUseCase,
    this._verifyPremiumPaymentUseCase,
    this._confirmDaySelectionUseCase, {
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
    on<InitiatePremiumPaymentEvent>(_onInitiatePayment);
    on<VerifyPremiumPaymentEvent>(_onVerifyPayment);
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
                slotIndex: slotIndex + 1,
                slotKey: 'slot_${slotIndex + 1}',
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

    // Update the slot first
    final next = current.copyWith(
      proteinId: event.proteinId,
      carbId: event.proteinId == null ? null : current.carbId,
    );
    slots[event.slotIndex] = next;

    final updated = Map<int, List<MealPlannerSlotSelection>>.from(
      s.selectedSlotsPerDay,
    )..[dayIndex] = slots;

    // Calculate total premium credits used across ALL days with the updated slots
    var totalUsedCredits = 0;
    
    for (final entry in updated.entries) {
      for (final slot in entry.value) {
        final proteinId = slot.proteinId;
        if (proteinId == null) continue;
        final protein = _findProteinById(s.menu, proteinId);
        if (protein == null || !protein.isPremium) continue;
        
        final cost = protein.premiumCreditCost == 0 ? 1 : protein.premiumCreditCost;
        totalUsedCredits += cost;
      }
    }

    // Calculate estimated pending payment count for UI display
    // This shows the user how many premium meals might need payment
    // BUT: The actual payment requirement is determined by backend after save
    // 
    // Why we calculate locally:
    // - To show user the estimated cost BEFORE they save
    // - To provide immediate feedback during selection
    // - To display price information from menu data
    // 
    // Why we still validate + save:
    // - Backend has the authoritative balance state
    // - Backend determines actual payment requirement
    // - Backend handles balance deduction logic
    // - Backend sets premiumSource (balance vs pending_payment)
    // 
    // Flow:
    // 1. Show estimated price during selection (local calculation)
    // 2. User clicks save → validate first
    // 3. Then save → backend determines actual payment requirement
    // 4. Show payment button only if backend says requiresPayment = true
    final pendingPaymentCount = totalUsedCredits > s.premiumMealsRemaining 
        ? totalUsedCredits - s.premiumMealsRemaining 
        : 0;

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
        premiumMealsPendingPayment: pendingPaymentCount,
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
      emit(s.copyWith(isSaving: true, paymentError: null));

      // Get the current day
      final currentDayIndex = s.selectedDayIndex;
      final currentDay = s.timelineDays[currentDayIndex];
      final slots = s.selectedSlotsPerDay[currentDayIndex] ?? [];
      
      // Filter only complete slots (both protein and carb selected)
      final completeSlots = slots
          .where((slot) => slot.proteinId != null && slot.carbId != null)
          .toList();

      if (completeSlots.length < currentDay.requiredMeals) {
        emit(s.copyWith(
          isSaving: false,
          paymentError: "Please complete all required meals (${completeSlots.length}/${currentDay.requiredMeals})",
        ));
        return;
      }

      // Build mealSlots in new format (without slotKey - backend generates it)
      final mealSlots = completeSlots.map((slot) {
        return MealSlotRequest(
          slotIndex: slot.slotIndex,
          proteinId: slot.proteinId,
          carbId: slot.carbId,
        );
      }).toList();

      final request = DaySelectionRequest(mealSlots);
      
      // Use the single-day save endpoint
      final result = await _saveDaySelectionUseCase.execute(
        SaveDaySelectionUseCaseInput(subscriptionId, currentDay.date, request),
      );

      result.fold(
        (failure) {
          if (!emit.isDone) {
            emit(s.copyWith(
              isSaving: false,
              paymentError: "${failure.code}: ${failure.message}",
            ));
          }
        },
        (updatedDay) {
          if (!emit.isDone) {
            // Update the current day's slots with the saved data
            final newSlots = updatedDay.mealSlots.map((slot) {
              return MealPlannerSlotSelection(
                slotIndex: slot.slotIndex,
                slotKey: slot.slotKey,
                proteinId: slot.proteinId,
                carbId: slot.carbId,
              );
            }).toList();

            final updatedSlotsPerDay = Map<int, List<MealPlannerSlotSelection>>.from(
              s.selectedSlotsPerDay,
            )..[currentDayIndex] = newSlots;

            final updatedSavedSlotsPerDay = Map<int, List<MealPlannerSlotSelection>>.from(
              s.savedSlotsPerDay,
            )..[currentDayIndex] = List<MealPlannerSlotSelection>.from(newSlots);

            // Check payment requirement from backend response
            final requiresPayment = updatedDay.paymentRequirement?.requiresPayment ?? false;
            final pendingPaymentCount = updatedDay.plannerMeta?.premiumPendingPaymentCount ?? 0;

            emit(s.copyWith(
              isSaving: false,
              saveSuccess: true,
              selectedSlotsPerDay: updatedSlotsPerDay,
              savedSlotsPerDay: updatedSavedSlotsPerDay,
              premiumMealsPendingPayment: requiresPayment ? pendingPaymentCount : 0,
            ));
          }
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

  Future<void> _onInitiatePayment(
    InitiatePremiumPaymentEvent event,
    Emitter<MealPlannerState> emit,
  ) async {
    if (state is! MealPlannerLoaded) return;
    final s = state as MealPlannerLoaded;
    
    emit(s.copyWith(isSaving: true, paymentError: null));
    
    // CRITICAL FIX: When user clicks "Pay Now", we need to:
    // 1. Validate the selection first
    // 2. Save the selection (PUT /selection)
    // 3. Backend determines if payment is required
    // 4. If payment required → create payment
    // 5. If not required → just show success
    
    final currentDay = s.timelineDays[s.selectedDayIndex];
    final slots = s.selectedSlotsPerDay[s.selectedDayIndex] ?? [];
    final completeSlots = slots
        .where((slot) => slot.proteinId != null && slot.carbId != null)
        .toList();

    if (completeSlots.length < currentDay.requiredMeals) {
      emit(s.copyWith(
        isSaving: false,
        paymentError: "Please complete all required meals (${completeSlots.length}/${currentDay.requiredMeals})",
      ));
      return;
    }

    final mealSlots = completeSlots.map((slot) {
      return MealSlotRequest(
        slotIndex: slot.slotIndex,
        proteinId: slot.proteinId,
        carbId: slot.carbId,
      );
    }).toList();
    final request = DaySelectionRequest(mealSlots);

    final saveResult = await _saveDaySelectionUseCase.execute(
      SaveDaySelectionUseCaseInput(subscriptionId, currentDay.date, request),
    );

    await saveResult.fold(
      (failure) async {
        emit(s.copyWith(
          isSaving: false,
          paymentError: "${failure.code}: ${failure.message}",
        ));
      },
      (updatedDay) async {
        final updatedSlots = updatedDay.mealSlots.map((slot) {
          return MealPlannerSlotSelection(
            slotIndex: slot.slotIndex,
            slotKey: slot.slotKey,
            proteinId: slot.proteinId,
            carbId: slot.carbId,
          );
        }).toList();

        final updatedSlotsPerDay = Map<int, List<MealPlannerSlotSelection>>.from(
          s.selectedSlotsPerDay,
        )..[s.selectedDayIndex] = updatedSlots;
        final updatedSavedSlotsPerDay = Map<int, List<MealPlannerSlotSelection>>.from(
          s.savedSlotsPerDay,
        )..[s.selectedDayIndex] = List<MealPlannerSlotSelection>.from(updatedSlots);

        final requiresPayment = updatedDay.paymentRequirement?.requiresPayment ?? false;
        final pendingPaymentCount = updatedDay.plannerMeta?.premiumPendingPaymentCount ?? 0;

        if (!requiresPayment) {
          emit(s.copyWith(
            isSaving: false,
            saveSuccess: true,
            selectedSlotsPerDay: updatedSlotsPerDay,
            savedSlotsPerDay: updatedSavedSlotsPerDay,
            premiumMealsPendingPayment: 0,
            paymentError: null,
          ));
          return;
        }

        final paymentResult = await _createPremiumPaymentUseCase.execute(
          CreatePremiumPaymentUseCaseInput(subscriptionId, currentDay.date),
        );

        paymentResult.fold(
          (failure) {
            if (failure.code == 'PREMIUM_EXTRA_PAYMENT_NOT_REQUIRED') {
              emit(s.copyWith(
                isSaving: false,
                saveSuccess: true,
                selectedSlotsPerDay: updatedSlotsPerDay,
                savedSlotsPerDay: updatedSavedSlotsPerDay,
                premiumMealsPendingPayment: 0,
                paymentError: null,
              ));
            } else {
              emit(s.copyWith(
                isSaving: false,
                paymentError: "${failure.code}: ${failure.message}",
              ));
            }
          },
          (paymentModel) {
            emit(s.copyWith(
              isSaving: false,
              saveSuccess: true,
              selectedSlotsPerDay: updatedSlotsPerDay,
              savedSlotsPerDay: updatedSavedSlotsPerDay,
              premiumMealsPendingPayment: pendingPaymentCount,
              paymentUrl: paymentModel.paymentUrl,
              paymentId: paymentModel.paymentId,
            ));
          },
        );
      },
    );
  }

  Future<void> _onVerifyPayment(
    VerifyPremiumPaymentEvent event,
    Emitter<MealPlannerState> emit,
  ) async {
    if (state is! MealPlannerLoaded) return;
    final s = state as MealPlannerLoaded;
    
    emit(s.copyWith(isSaving: true));
    
    final currentDay = s.timelineDays[s.selectedDayIndex];
    
    final result = await _verifyPremiumPaymentUseCase.execute(
      VerifyPremiumPaymentUseCaseInput(subscriptionId, currentDay.date, event.paymentId),
    );
    
    result.fold(
      (failure) {
        emit(s.copyWith(
          isSaving: false,
          paymentError: "${failure.code}: ${failure.message}",
        ));
      },
      (verificationModel) {
        if (verificationModel.paymentStatus == "paid") {
          _confirmDaySelectionUseCase
              .execute(ConfirmDaySelectionUseCaseInput(subscriptionId, currentDay.date))
              .then((confirmResult) {
            if (emit.isDone) return;
            confirmResult.fold(
              (failure) {
                emit(s.copyWith(
                  isSaving: false,
                  paymentError: "${failure.code}: ${failure.message}",
                ));
              },
              (_) {
                emit(s.copyWith(
                  isSaving: false,
                  premiumMealsPendingPayment: 0,
                  paymentUrl: null,
                  paymentId: null,
                  saveSuccess: true,
                ));
              },
            );
          });
        } else {
          emit(s.copyWith(
            isSaving: false,
            paymentError: verificationModel.message,
          ));
        }
      },
    );
  }
}
