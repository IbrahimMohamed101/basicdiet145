import 'package:basic_diet/domain/usecase/get_meal_planner_menu_usecase.dart';
import 'package:basic_diet/domain/usecase/save_meal_planner_changes_usecase.dart';
import 'package:basic_diet/domain/usecase/create_premium_payment_usecase.dart';
import 'package:basic_diet/domain/usecase/verify_premium_payment_usecase.dart';
import 'package:basic_diet/domain/model/meal_planner_menu_model.dart';
import 'package:basic_diet/domain/model/timeline_model.dart';
import 'package:basic_diet/data/request/bulk_selections_request.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'meal_planner_event.dart';
import 'meal_planner_state.dart';

class MealPlannerBloc extends Bloc<MealPlannerEvent, MealPlannerState> {
  final GetMealPlannerMenuUseCase _getMealPlannerMenuUseCase;
  final SaveMealPlannerChangesUseCase _saveMealPlannerChangesUseCase;
  final CreatePremiumPaymentUseCase _createPremiumPaymentUseCase;
  final VerifyPremiumPaymentUseCase _verifyPremiumPaymentUseCase;
  final List<TimelineDayModel> initialTimelineDays;
  final int initialDayIndex;
  final int premiumMealsRemaining;
  final String subscriptionId;

  MealPlannerBloc(
    this._getMealPlannerMenuUseCase,
    this._saveMealPlannerChangesUseCase,
    this._createPremiumPaymentUseCase,
    this._verifyPremiumPaymentUseCase, {
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

    // Now calculate total premium credits used across ALL days with the updated slots
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

    // CRITICAL FIX: Do NOT calculate pending payment locally
    // The backend will determine if payment is needed after save based on:
    // 1. User's actual premium balance
    // 2. Whether premium can be covered by balance
    // 3. Premium source (balance vs pending_payment)
    // 
    // Local calculation is unreliable because:
    // - We don't know the exact balance state
    // - Backend might have different premium pricing
    // - Backend handles balance deduction logic
    // 
    // Therefore: Keep pendingPaymentCount at 0 during selection
    // Only show payment button AFTER save if backend says payment is required
    final pendingPaymentCount = 0;

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
          if (!emit.isDone) {
            emit(s.copyWith(
              isSaving: false,
              paymentError: "${failure.code}: ${failure.message}",
            ));
          }
        },
        (bulkResponse) {
          // Check if any days failed
          final failedDays = bulkResponse.results
              .where((r) => !r.ok)
              .toList();
          
          if (failedDays.isNotEmpty) {
            // Build error message showing which days failed
            final errorMessages = failedDays.map((r) {
              final date = r.date;
              final code = r.code ?? 'UNKNOWN';
              final message = r.message ?? 'Failed to save';
              return '$date: $message';
            }).join('\n');
            
            if (!emit.isDone) {
              emit(s.copyWith(
                isSaving: false,
                paymentError: errorMessages,
              ));
            }
          } else {
            // All days saved successfully
            // CRITICAL FIX: After bulk save, backend has already determined payment requirements
            // The backend will deduct from premiumBalance first, then determine if extra payment is needed
            // Since bulk save doesn't return individual day payment requirements,
            // we MUST set premiumMealsPendingPayment to 0 to avoid showing payment button incorrectly
            // 
            // IMPORTANT: The backend handles payment logic:
            // - If premium is covered by balance → premiumSource = "balance", no payment needed
            // - If premium exceeds balance → premiumSource = "pending_payment", payment needed
            // - But bulk save endpoint doesn't expose this per-day info
            // 
            // Therefore: DO NOT show payment button after bulk save
            // If payment is actually needed, user should use single-day flow with proper payment requirement check
            
            if (!emit.isDone) {
              emit(s.copyWith(
                isSaving: false,
                saveSuccess: true,
                savedSlotsPerDay: Map<int, List<MealPlannerSlotSelection>>.from(
                  s.selectedSlotsPerDay,
                ),
                // Set to 0 to hide payment button
                // Backend has already handled premium balance deduction
                premiumMealsPendingPayment: 0,
              ));
            }
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
    
    if (s.premiumMealsPendingPayment <= 0) return;
    
    emit(s.copyWith(isSaving: true));
    
    // Get the current day's date
    final currentDay = s.timelineDays[s.selectedDayIndex];
    
    final result = await _createPremiumPaymentUseCase.execute(
      CreatePremiumPaymentUseCaseInput(subscriptionId, currentDay.date),
    );
    
    result.fold(
      (failure) {
        emit(s.copyWith(
          isSaving: false,
          paymentError: "${failure.code}: ${failure.message}",
        ));
      },
      (paymentModel) {
        emit(s.copyWith(
          isSaving: false,
          paymentUrl: paymentModel.paymentUrl,
          paymentId: paymentModel.paymentId,
        ));
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
          // Payment successful - reset pending payment count
          emit(s.copyWith(
            isSaving: false,
            premiumMealsPendingPayment: 0,
            paymentUrl: null,
            paymentId: null,
          ));
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
