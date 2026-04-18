import 'package:basic_diet/domain/usecase/get_subscription_day_usecase.dart';
import 'package:basic_diet/domain/usecase/get_meal_planner_menu_usecase.dart';
import 'package:basic_diet/domain/usecase/validate_day_selection_usecase.dart';
import 'package:basic_diet/domain/usecase/save_day_selection_usecase.dart';
import 'package:basic_diet/domain/usecase/confirm_day_selection_usecase.dart';
import 'package:basic_diet/domain/usecase/create_premium_payment_usecase.dart';
import 'package:basic_diet/domain/usecase/verify_premium_payment_usecase.dart';
import 'package:basic_diet/domain/model/meal_planner_menu_model.dart';
import 'package:basic_diet/domain/model/subscription_day_model.dart';
import 'package:basic_diet/data/request/day_selection_request.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'meal_planner_event.dart';
import 'meal_planner_state.dart';

/// Corrected MealPlannerBloc following MEAL_PLANNER_INTEGRATION.md
/// 
/// CRITICAL PAYMENT FLOW (as per backend requirements):
/// 
/// 1. User selects meals (including premium) → Local state update only (no API calls)
/// 
/// 2. User clicks "Save" → _onSave() is called:
///    a. POST /selection/validate (optional but recommended)
///    b. PUT /selection (saves the selection)
///    c. Backend determines payment requirement:
///       - If balance covers premium: premiumSource = "balance", requiresPayment = false
///       - If balance doesn't cover: premiumSource = "pending_payment", requiresPayment = true
///    d. Backend returns updated day with paymentRequirement and plannerMeta
/// 
/// 3. After save, check paymentRequirement.requiresPayment:
///    - If FALSE: Premium covered by balance, no payment needed, can confirm directly
///    - If TRUE: UI shows "Pay Now" button with amount from paymentRequirement.amount
/// 
/// 4. User clicks "Pay Now" → _onInitiatePayment() is called:
///    - ONLY if paymentRequirement.requiresPayment === true
///    - POST /subscriptions/:id/days/:date/premium-extra/payments
///    - Returns paymentUrl and paymentId
/// 
/// 5. Open paymentUrl in WebView/browser
/// 
/// 6. After payment completion → _onVerifyPayment() is called:
///    - POST /subscriptions/:id/days/:date/premium-extra/payments/:id/verify
///    - If successful: paymentStatus = "paid"
///    - Reload day data to get updated state
/// 
/// 7. After verification, check updated state:
///    - paymentRequirement.requiresPayment should now be false
///    - commercialState should be "ready_to_confirm"
///    - Can now call confirm
/// 
/// 8. User clicks "Confirm" → _onConfirm() is called:
///    - POST /subscriptions/:id/days/:date/confirm
///    - Only allowed when plannerMeta.isConfirmable === true
/// 
/// IMPORTANT NOTES:
/// - DO NOT create payment immediately after selecting premium meal
/// - DO NOT create payment during save operation
/// - ONLY create payment when user explicitly clicks "Pay Now" button
/// - Payment button should only appear when paymentRequirement.requiresPayment === true
/// - Any attempt to create payment when not required will result in PREMIUM_EXTRA_PAYMENT_NOT_REQUIRED error
class MealPlannerBlocFixed extends Bloc<MealPlannerEvent, MealPlannerState> {
  final GetSubscriptionDayUseCase _getSubscriptionDayUseCase;
  final GetMealPlannerMenuUseCase _getMealPlannerMenuUseCase;
  final ValidateDaySelectionUseCase _validateDaySelectionUseCase;
  final SaveDaySelectionUseCase _saveDaySelectionUseCase;
  final ConfirmDaySelectionUseCase _confirmDaySelectionUseCase;
  final CreatePremiumPaymentUseCase _createPremiumPaymentUseCase;
  final VerifyPremiumPaymentUseCase _verifyPremiumPaymentUseCase;
  
  final String subscriptionId;
  final String initialDate;

  MealPlannerBlocFixed(
    this._getSubscriptionDayUseCase,
    this._getMealPlannerMenuUseCase,
    this._validateDaySelectionUseCase,
    this._saveDaySelectionUseCase,
    this._confirmDaySelectionUseCase,
    this._createPremiumPaymentUseCase,
    this._verifyPremiumPaymentUseCase, {
    required this.subscriptionId,
    required this.initialDate,
  }) : super(MealPlannerInitial()) {
    on<LoadMealPlannerDataEvent>(_onLoadData);
    on<SetMealSlotProteinEvent>(_onSetProtein);
    on<SetMealSlotCarbEvent>(_onSetCarb);
    on<ValidateDaySelectionEvent>(_onValidate);
    on<SaveDaySelectionEvent>(_onSave);
    on<SaveMealPlannerChangesEvent>(_onSaveMealPlannerChanges); // Map UI event to save
    on<ConfirmDaySelectionEvent>(_onConfirm);
    on<InitiatePremiumPaymentEvent>(_onInitiatePayment);
    on<VerifyPremiumPaymentEvent>(_onVerifyPayment);
    on<ReloadDayDataEvent>(_onReloadDay);
    on<HideBannerEvent>(_onHideBanner);
  }

  /// Phase 1: Load screen data
  /// Calls:
  /// - GET /subscriptions/:id/days/:date
  /// - GET /subscriptions/meal-planner-menu
  Future<void> _onLoadData(
    LoadMealPlannerDataEvent event,
    Emitter<MealPlannerState> emit,
  ) async {
    emit(MealPlannerLoading());

    // Load menu catalog
    final menuResult = await _getMealPlannerMenuUseCase.execute(null);
    
    await menuResult.fold(
      (failure) async {
        emit(MealPlannerError("${failure.code}: ${failure.message}"));
      },
      (menu) async {
        // Load day data
        final dayResult = await _getSubscriptionDayUseCase.execute(
          GetSubscriptionDayUseCaseInput(subscriptionId, event.date),
        );

        dayResult.fold(
          (failure) {
            emit(MealPlannerError("${failure.code}: ${failure.message}"));
          },
          (day) {
            // Convert backend mealSlots to local selection format
            final currentSlots = day.mealSlots.map((slot) {
              return MealPlannerSlotSelection(
                slotIndex: slot.slotIndex,
                slotKey: slot.slotKey,
                proteinId: slot.proteinId,
                carbId: slot.carbId,
              );
            }).toList();

            // Initially, saved = current (no local changes yet)
            final savedSlots = List<MealPlannerSlotSelection>.from(currentSlots);

            emit(
              MealPlannerLoadedNew(
                day: day,
                menu: menu,
                currentSlots: currentSlots,
                savedSlots: savedSlots,
                plannerMeta: day.plannerMeta,
                paymentRequirement: day.paymentRequirement,
                slotErrors: {},
                validationInProgress: false,
              ),
            );
          },
        );
      },
    );
  }

  /// Phase 2: User selects protein
  /// Updates local state only
  void _onSetProtein(
    SetMealSlotProteinEvent event,
    Emitter<MealPlannerState> emit,
  ) {
    if (state is! MealPlannerLoadedNew) return;
    final s = state as MealPlannerLoadedNew;

    // Check if day is editable
    if (!_isDayEditable(s.day)) return;

    final slots = List<MealPlannerSlotSelection>.from(s.currentSlots);
    
    // Find slot by index
    final slotIdx = slots.indexWhere((slot) => slot.slotIndex == event.slotIndex);
    if (slotIdx == -1) return;

    final current = slots[slotIdx];
    if (current.proteinId == event.proteinId) return;

    // Update slot
    slots[slotIdx] = current.copyWith(
      proteinId: event.proteinId,
      // Clear carb if protein is cleared
      carbId: event.proteinId == null ? null : current.carbId,
    );

    // Get protein name for banner
    String proteinName = '';
    if (event.proteinId != null) {
      final protein = _findProteinById(s.menu, event.proteinId!);
      proteinName = protein?.name ?? '';
    }

    emit(
      s.copyWith(
        currentSlots: slots,
        showSavedBanner: event.proteinId != null,
        lastAddedMealName: proteinName.isNotEmpty ? proteinName : s.lastAddedMealName,
        // Clear previous validation errors when user makes changes
        slotErrors: {},
      ),
    );
  }

  /// Phase 2: User selects carb
  /// Updates local state only
  void _onSetCarb(
    SetMealSlotCarbEvent event,
    Emitter<MealPlannerState> emit,
  ) {
    if (state is! MealPlannerLoadedNew) return;
    final s = state as MealPlannerLoadedNew;

    if (!_isDayEditable(s.day)) return;

    final slots = List<MealPlannerSlotSelection>.from(s.currentSlots);
    
    final slotIdx = slots.indexWhere((slot) => slot.slotIndex == event.slotIndex);
    if (slotIdx == -1) return;

    final current = slots[slotIdx];
    if (current.carbId == event.carbId) return;

    slots[slotIdx] = current.copyWith(carbId: event.carbId);

    emit(
      s.copyWith(
        currentSlots: slots,
        slotErrors: {},
      ),
    );
  }

  /// Phase 3: Validate draft (optional but recommended)
  /// Calls: POST /subscriptions/:id/days/:date/selection/validate
  Future<void> _onValidate(
    ValidateDaySelectionEvent event,
    Emitter<MealPlannerState> emit,
  ) async {
    if (state is! MealPlannerLoadedNew) return;
    final s = state as MealPlannerLoadedNew;

    emit(s.copyWith(validationInProgress: true, paymentError: null));

    final request = _buildDaySelectionRequest(s.currentSlots);
    
    final result = await _validateDaySelectionUseCase.execute(
      ValidateDaySelectionUseCaseInput(subscriptionId, s.day.date, request),
    );

    result.fold(
      (failure) {
        emit(s.copyWith(
          validationInProgress: false,
          paymentError: "${failure.code}: ${failure.message}",
        ));
      },
      (validationResult) {
        // Build slot errors map
        final slotErrorsMap = <int, SlotErrorModel>{};
        if (validationResult.slotErrors != null) {
          for (final error in validationResult.slotErrors!) {
            slotErrorsMap[error.slotIndex] = error;
          }
        }

        emit(s.copyWith(
          validationInProgress: false,
          plannerMeta: validationResult.plannerMeta ?? s.plannerMeta,
          paymentRequirement: validationResult.paymentRequirement ?? s.paymentRequirement,
          slotErrors: slotErrorsMap,
        ));
      },
    );
  }

  /// Phase 4: Save draft
  /// Calls: 
  /// 1. POST /subscriptions/:id/days/:date/selection/validate (optional but recommended)
  /// 2. PUT /subscriptions/:id/days/:date/selection
  /// 
  /// CRITICAL FLOW:
  /// - User selects meals (including premium) → local state only
  /// - User clicks "Save" → THIS method is called
  /// - First validate, then save
  /// - Backend determines if payment needed based on:
  ///   * Premium meals selected
  ///   * Available balance
  ///   * If balance covers premium: premiumSource = "balance", requiresPayment = false
  ///   * If balance doesn't cover: premiumSource = "pending_payment", requiresPayment = true
  /// - After save, check paymentRequirement.requiresPayment
  /// - If true, UI shows "Pay Now" button
  /// - DO NOT create payment here - wait for user to click "Pay Now"
  Future<void> _onSave(
    SaveDaySelectionEvent event,
    Emitter<MealPlannerState> emit,
  ) async {
    if (state is! MealPlannerLoadedNew) return;
    final s = state as MealPlannerLoadedNew;

    if (!s.canSave) return;

    emit(s.copyWith(isSaving: true, paymentError: null));

    final request = _buildDaySelectionRequest(s.currentSlots);
    
    // Step 1: Validate first (recommended)
    final validateResult = await _validateDaySelectionUseCase.execute(
      ValidateDaySelectionUseCaseInput(subscriptionId, s.day.date, request),
    );

    // Check validation result
    final validationFailed = validateResult.fold(
      (failure) {
        emit(s.copyWith(
          isSaving: false,
          paymentError: "${failure.code}: ${failure.message}",
        ));
        return true;
      },
      (validationResult) {
        // Check for slot errors
        if (validationResult.slotErrors != null && validationResult.slotErrors!.isNotEmpty) {
          final slotErrorsMap = <int, SlotErrorModel>{};
          for (final error in validationResult.slotErrors!) {
            slotErrorsMap[error.slotIndex] = error;
          }
          emit(s.copyWith(
            isSaving: false,
            slotErrors: slotErrorsMap,
            paymentError: "Please fix validation errors before saving",
          ));
          return true;
        }
        return false;
      },
    );

    if (validationFailed) return;

    // Step 2: Save the selection
    final result = await _saveDaySelectionUseCase.execute(
      SaveDaySelectionUseCaseInput(subscriptionId, s.day.date, request),
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
          // Convert updated mealSlots to local format
          final newCurrentSlots = updatedDay.mealSlots.map((slot) {
            return MealPlannerSlotSelection(
              slotIndex: slot.slotIndex,
              slotKey: slot.slotKey,
              proteinId: slot.proteinId,
              carbId: slot.carbId,
            );
          }).toList();

          // After save, current = saved (no local changes)
          final newSavedSlots = List<MealPlannerSlotSelection>.from(newCurrentSlots);

          // IMPORTANT: Backend has now determined payment requirement
          // - If paymentRequirement.requiresPayment === true → UI will show "Pay Now" button
          // - If false → premium is covered by balance, no payment needed
          // - plannerMeta.premiumPendingPaymentCount shows how many premium meals need payment

          emit(s.copyWith(
            isSaving: false,
            saveSuccess: true,
            day: updatedDay,
            currentSlots: newCurrentSlots,
            savedSlots: newSavedSlots,
            plannerMeta: updatedDay.plannerMeta,
            paymentRequirement: updatedDay.paymentRequirement,
            slotErrors: {},
          ));
        }
      },
    );
  }

  /// Handler for SaveMealPlannerChangesEvent (used by UI)
  /// Maps to SaveDaySelectionEvent for consistency
  Future<void> _onSaveMealPlannerChanges(
    SaveMealPlannerChangesEvent event,
    Emitter<MealPlannerState> emit,
  ) async {
    // Delegate to the main save handler
    await _onSave(const SaveDaySelectionEvent(), emit);
  }

  /// Phase 5: Create premium payment
  /// Calls: POST /subscriptions/:id/days/:date/premium-extra/payments
  /// 
  /// CRITICAL: Only call when ALL conditions are met:
  /// 1. Day must be SAVED first (via PUT /selection)
  /// 2. Backend must have determined: paymentRequirement.requiresPayment === true
  /// 3. Backend must have set: plannerMeta.premiumPendingPaymentCount > 0
  /// 4. Premium meals must have: premiumSource === "pending_payment"
  /// 
  /// DO NOT call this endpoint:
  /// - Immediately after user selects premium meal (must save first)
  /// - If paymentRequirement.requiresPayment === false
  /// - If premium meals are covered by balance (premiumSource === "balance")
  /// 
  /// The flow is:
  /// 1. User selects premium meal → local state only
  /// 2. App calls validate (optional)
  /// 3. App calls save (PUT /selection)
  /// 4. Backend determines if payment needed
  /// 5. If requiresPayment === true → THEN call this endpoint
  Future<void> _onInitiatePayment(
    InitiatePremiumPaymentEvent event,
    Emitter<MealPlannerState> emit,
  ) async {
    if (state is! MealPlannerLoadedNew) return;
    final s = state as MealPlannerLoadedNew;

    // CRITICAL CHECK: Payment must be required by backend
    // This is determined AFTER save, not during selection
    if (s.paymentRequirement?.requiresPayment != true) {
      emit(s.copyWith(
        paymentError: "No payment required. Premium meals may be covered by balance.",
      ));
      return;
    }

    // Additional safety check
    if (s.plannerMeta?.premiumPendingPaymentCount == 0) {
      emit(s.copyWith(
        paymentError: "No premium meals pending payment.",
      ));
      return;
    }

    emit(s.copyWith(isSaving: true, paymentError: null));

    final result = await _createPremiumPaymentUseCase.execute(
      CreatePremiumPaymentUseCaseInput(subscriptionId, s.day.date),
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

  /// Phase 6: Verify premium payment
  /// Calls: POST /subscriptions/:id/days/:date/premium-extra/payments/:id/verify
  /// 
  /// After successful verification:
  /// - Reload day data to get updated state
  /// - Check paymentRequirement.requiresPayment should be false
  /// - Check commercialState should be "ready_to_confirm"
  Future<void> _onVerifyPayment(
    VerifyPremiumPaymentEvent event,
    Emitter<MealPlannerState> emit,
  ) async {
    if (state is! MealPlannerLoadedNew) return;
    final s = state as MealPlannerLoadedNew;

    emit(s.copyWith(isSaving: true, paymentError: null));

    final result = await _verifyPremiumPaymentUseCase.execute(
      VerifyPremiumPaymentUseCaseInput(subscriptionId, s.day.date, event.paymentId),
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
          // Payment successful - reload day data
          emit(s.copyWith(isSaving: false));
          add(ReloadDayDataEvent(s.day.date));
        } else if (verificationModel.paymentStatus == "revision_mismatch") {
          emit(s.copyWith(
            isSaving: false,
            paymentError: "Payment no longer valid. Meal selection was changed after payment creation. Please create a new payment.",
            paymentUrl: null,
            paymentId: null,
          ));
        } else {
          emit(s.copyWith(
            isSaving: false,
            paymentError: verificationModel.message ?? "Payment verification failed",
          ));
        }
      },
    );
  }

  /// Phase 7: Confirm day
  /// Calls: POST /subscriptions/:id/days/:date/confirm
  /// 
  /// Only allow when:
  /// - plannerMeta.isConfirmable === true
  /// - paymentRequirement.requiresPayment === false
  /// - status === "open"
  /// - plannerState !== "confirmed"
  Future<void> _onConfirm(
    ConfirmDaySelectionEvent event,
    Emitter<MealPlannerState> emit,
  ) async {
    if (state is! MealPlannerLoadedNew) return;
    final s = state as MealPlannerLoadedNew;

    // Validate confirm conditions
    if (!_canConfirm(s)) {
      emit(s.copyWith(
        paymentError: "Cannot confirm: requirements not met",
      ));
      return;
    }

    emit(s.copyWith(isSaving: true, paymentError: null));

    final result = await _confirmDaySelectionUseCase.execute(
      ConfirmDaySelectionUseCaseInput(subscriptionId, s.day.date),
    );

    result.fold(
      (failure) {
        emit(s.copyWith(
          isSaving: false,
          paymentError: "${failure.code}: ${failure.message}",
        ));
      },
      (confirmResult) {
        // Reload day to get confirmed state
        emit(s.copyWith(isSaving: false));
        add(ReloadDayDataEvent(s.day.date));
      },
    );
  }

  /// Reload day data after operations
  /// Calls: GET /subscriptions/:id/days/:date
  Future<void> _onReloadDay(
    ReloadDayDataEvent event,
    Emitter<MealPlannerState> emit,
  ) async {
    if (state is! MealPlannerLoadedNew) return;
    final s = state as MealPlannerLoadedNew;

    final result = await _getSubscriptionDayUseCase.execute(
      GetSubscriptionDayUseCaseInput(subscriptionId, event.date),
    );

    result.fold(
      (failure) {
        emit(s.copyWith(
          paymentError: "${failure.code}: ${failure.message}",
        ));
      },
      (updatedDay) {
        final newCurrentSlots = updatedDay.mealSlots.map((slot) {
          return MealPlannerSlotSelection(
            slotIndex: slot.slotIndex,
            slotKey: slot.slotKey,
            proteinId: slot.proteinId,
            carbId: slot.carbId,
          );
        }).toList();

        final newSavedSlots = List<MealPlannerSlotSelection>.from(newCurrentSlots);

        emit(s.copyWith(
          day: updatedDay,
          currentSlots: newCurrentSlots,
          savedSlots: newSavedSlots,
          plannerMeta: updatedDay.plannerMeta,
          paymentRequirement: updatedDay.paymentRequirement,
          paymentUrl: null,
          paymentId: null,
        ));
      },
    );
  }

  void _onHideBanner(HideBannerEvent event, Emitter<MealPlannerState> emit) {
    if (state is MealPlannerLoadedNew) {
      final s = state as MealPlannerLoadedNew;
      emit(s.copyWith(showSavedBanner: false));
    }
  }

  // Helper methods

  bool _isDayEditable(SubscriptionDayModel day) {
    // Day is editable if:
    // - status is "open", "planned", or "extension"
    // - plannerState is not "confirmed"
    final editableStatuses = ['open', 'planned', 'extension'];
    return editableStatuses.contains(day.status.toLowerCase()) &&
        day.plannerState != 'confirmed';
  }

  bool _canConfirm(MealPlannerLoadedNew state) {
    // Can confirm only when:
    // 1. plannerMeta.isConfirmable === true
    // 2. paymentRequirement.requiresPayment === false
    // 3. status === "open"
    // 4. plannerState !== "confirmed"
    
    if (state.plannerMeta?.isConfirmable != true) return false;
    if (state.paymentRequirement?.requiresPayment == true) return false;
    if (state.day.status.toLowerCase() != 'open') return false;
    if (state.day.plannerState == 'confirmed') return false;
    
    return true;
  }

  DaySelectionRequest _buildDaySelectionRequest(
    List<MealPlannerSlotSelection> slots,
  ) {
    final mealSlots = slots.map((slot) {
      return MealSlotRequest(
        slot.slotIndex,
        slot.slotKey,
        slot.proteinId,
        slot.carbId,
      );
    }).toList();

    return DaySelectionRequest(mealSlots);
  }

  BuilderProteinModel? _findProteinById(MealPlannerMenuModel menu, String id) {
    for (final protein in menu.builderCatalog.proteins) {
      if (protein.id == id) return protein;
    }
    return null;
  }
}
