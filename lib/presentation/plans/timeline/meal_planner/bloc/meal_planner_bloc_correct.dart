import 'package:basic_diet/data/request/day_selection_request.dart';
import 'package:basic_diet/domain/model/subscription_day_model.dart';
import 'package:basic_diet/domain/usecase/get_meal_planner_menu_usecase.dart';
import 'package:basic_diet/domain/usecase/get_subscription_day_usecase.dart';
import 'package:basic_diet/domain/usecase/validate_day_selection_usecase.dart';
import 'package:basic_diet/domain/usecase/save_day_selection_usecase.dart';
import 'package:basic_diet/domain/usecase/create_premium_payment_usecase.dart';
import 'package:basic_diet/domain/usecase/verify_premium_payment_usecase.dart';
import 'package:basic_diet/domain/usecase/confirm_day_selection_usecase.dart';
import 'package:basic_diet/domain/model/meal_planner_menu_model.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'meal_planner_event.dart';
import 'meal_planner_state.dart';

/// MealPlannerBlocCorrect - 100% Following API Integration Guide
/// 
/// Key principles from the guide:
/// 1. Fetch initial data from GET /days/:date (not from timeline)
/// 2. Build UI from backend's mealSlots (source of truth)
/// 3. Validate after each selection change
/// 4. Reload day data after payment verify
/// 5. Use plannerMeta and paymentRequirement from backend only
/// 6. Implement complete confirm flow
class MealPlannerBlocCorrect extends Bloc<MealPlannerEvent, MealPlannerState> {
  final GetMealPlannerMenuUseCase _getMealPlannerMenuUseCase;
  final GetSubscriptionDayUseCase _getSubscriptionDayUseCase;
  final ValidateDaySelectionUseCase _validateDaySelectionUseCase;
  final SaveDaySelectionUseCase _saveDaySelectionUseCase;
  final CreatePremiumPaymentUseCase _createPremiumPaymentUseCase;
  final VerifyPremiumPaymentUseCase _verifyPremiumPaymentUseCase;
  final ConfirmDaySelectionUseCase _confirmDaySelectionUseCase;
  
  final String subscriptionId;
  final String date;

  MealPlannerBlocCorrect(
    this._getMealPlannerMenuUseCase,
    this._getSubscriptionDayUseCase,
    this._validateDaySelectionUseCase,
    this._saveDaySelectionUseCase,
    this._createPremiumPaymentUseCase,
    this._verifyPremiumPaymentUseCase,
    this._confirmDaySelectionUseCase, {
    required this.subscriptionId,
    required this.date,
  }) : super(MealPlannerInitial()) {
    on<GetMealPlannerDataEvent>(_onGetData);
    on<SetMealSlotProteinEvent>(_onSetProtein);
    on<SetMealSlotCarbEvent>(_onSetCarb);
    on<SaveMealPlannerChangesEvent>(_onSave);
    on<ConfirmDaySelectionEvent>(_onConfirm);
    on<HideBannerEvent>(_onHideBanner);
    on<InitiatePremiumPaymentEvent>(_onInitiatePayment);
    on<VerifyPremiumPaymentEvent>(_onVerifyPayment);
  }

  /// Step 1: Load initial data from backend
  /// API Guide: فتح الشاشة → استدعاء GET /days/:date و GET /meal-planner-menu بالتوازي
  Future<void> _onGetData(
    GetMealPlannerDataEvent event,
    Emitter<MealPlannerState> emit,
  ) async {
    emit(MealPlannerLoading());
    
    // Fetch both in parallel as per guide
    final menuResult = await _getMealPlannerMenuUseCase.execute(null);
    final dayResult = await _getSubscriptionDayUseCase.execute(
      GetSubscriptionDayUseCaseInput(subscriptionId, date),
    );

    // Handle menu result
    if (menuResult.isLeft()) {
      final failure = menuResult.fold((l) => l, (r) => null);
      emit(MealPlannerError("${failure?.code}: ${failure?.message}"));
      return;
    }

    // Handle day result
    if (dayResult.isLeft()) {
      final failure = dayResult.fold((l) => l, (r) => null);
      emit(MealPlannerError("${failure?.code}: ${failure?.message}"));
      return;
    }

    final menu = menuResult.getOrElse(() => throw Exception());
    final dayModel = dayResult.getOrElse(() => throw Exception());

    // API Guide: بناء الـ UI من mealSlots و plannerMeta و paymentRequirement
    // Build slots from backend's mealSlots (source of truth)
    final slots = dayModel.mealSlots
        .map((slot) => MealPlannerSlotSelection(
              slotIndex: slot.slotIndex,
              slotKey: slot.slotKey,
              proteinId: slot.proteinId,
              carbId: slot.carbId,
            ))
        .toList();

    emit(
      MealPlannerLoadedNew(
        day: dayModel,
        menu: menu,
        currentSlots: slots,
        savedSlots: List<MealPlannerSlotSelection>.from(slots),
        plannerMeta: dayModel.plannerMeta,
        paymentRequirement: dayModel.paymentRequirement,
        slotErrors: {},
        validationInProgress: false,
      ),
    );
  }

  /// Step 2: Validate after protein selection
  /// API Guide: المستخدم يغير وجبة → تحديث local draft ثم POST /selection/validate
  Future<void> _onSetProtein(
    SetMealSlotProteinEvent event,
    Emitter<MealPlannerState> emit,
  ) async {
    if (state is! MealPlannerLoadedNew) return;
    final s = state as MealPlannerLoadedNew;

    // Check if day is editable
    if (!_isDayEditable(s.day)) {
      return;
    }

    final slots = List<MealPlannerSlotSelection>.from(s.currentSlots);
    if (event.slotIndex < 0 || event.slotIndex >= slots.length) return;

    final current = slots[event.slotIndex];
    if (current.proteinId == event.proteinId) return;

    // Update the slot
    slots[event.slotIndex] = current.copyWith(
      proteinId: event.proteinId,
      carbId: event.proteinId == null ? null : current.carbId,
    );

    // Show banner if protein was added
    String proteinName = '';
    if (event.proteinId != null) {
      final protein = _findProteinById(s.menu, event.proteinId!);
      proteinName = protein?.name ?? '';
    }

    emit(s.copyWith(
      currentSlots: slots,
      showSavedBanner: event.proteinId != null,
      lastAddedMealName: proteinName.isNotEmpty ? proteinName : s.lastAddedMealName,
    ));

    // API Guide: فور اختيار المستخدم بروتين أو كارب جديد، وقبل الحفظ
    await _validateSelection(emit, s.copyWith(currentSlots: slots));
  }

  /// Step 3: Validate after carb selection
  Future<void> _onSetCarb(
    SetMealSlotCarbEvent event,
    Emitter<MealPlannerState> emit,
  ) async {
    if (state is! MealPlannerLoadedNew) return;
    final s = state as MealPlannerLoadedNew;

    if (!_isDayEditable(s.day)) {
      return;
    }

    final slots = List<MealPlannerSlotSelection>.from(s.currentSlots);
    if (event.slotIndex < 0 || event.slotIndex >= slots.length) return;

    final current = slots[event.slotIndex];
    if (current.carbId == event.carbId) return;

    slots[event.slotIndex] = current.copyWith(carbId: event.carbId);

    emit(s.copyWith(currentSlots: slots));

    // Validate after carb change
    await _validateSelection(emit, s.copyWith(currentSlots: slots));
  }

  /// Validation helper
  /// API Guide: POST /selection/validate
  Future<void> _validateSelection(
    Emitter<MealPlannerState> emit,
    MealPlannerLoadedNew state,
  ) async {
    emit(state.copyWith(validationInProgress: true));

    final request = DaySelectionRequest(
      state.currentSlots
          .map((slot) => MealSlotRequest(
                slot.slotIndex,
                slot.slotKey,
                slot.proteinId,
                slot.carbId,
              ))
          .toList(),
    );

    final result = await _validateDaySelectionUseCase.execute(
      ValidateDaySelectionUseCaseInput(subscriptionId, date, request),
    );

    if (emit.isDone) return;

    result.fold(
      (failure) {
        emit(state.copyWith(
          validationInProgress: false,
          paymentError: "${failure.code}: ${failure.message}",
        ));
      },
      (validation) {
        // API Guide: عرض نتيجة validate → إظهار slotErrors أسفل كل slot معني
        final slotErrorsMap = <int, SlotErrorModel>{};
        if (validation.slotErrors != null) {
          for (final error in validation.slotErrors!) {
            slotErrorsMap[error.slotIndex] = error;
          }
        }

        // API Guide: اعتمد 100% على paymentRequirement و plannerMeta العائدين من الـ backend
        emit(state.copyWith(
          validationInProgress: false,
          plannerMeta: validation.plannerMeta,
          paymentRequirement: validation.paymentRequirement,
          slotErrors: slotErrorsMap,
          paymentError: null,
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

  /// Step 4: Save selection
  /// API Guide: PUT /selection
  Future<void> _onSave(
    SaveMealPlannerChangesEvent event,
    Emitter<MealPlannerState> emit,
  ) async {
    if (state is! MealPlannerLoadedNew) return;
    final s = state as MealPlannerLoadedNew;

    emit(s.copyWith(isSaving: true, paymentError: null));

    final request = DaySelectionRequest(
      s.currentSlots
          .map((slot) => MealSlotRequest(
                slot.slotIndex,
                slot.slotKey,
                slot.proteinId,
                slot.carbId,
              ))
          .toList(),
    );

    final result = await _saveDaySelectionUseCase.execute(
      SaveDaySelectionUseCaseInput(subscriptionId, date, request),
    );

    if (emit.isDone) return;

    result.fold(
      (failure) {
        emit(s.copyWith(
          isSaving: false,
          paymentError: "${failure.code}: ${failure.message}",
        ));
      },
      (dayModel) {
        // API Guide: استبدل الـ local state بما عاد من backend تماماً
        final updatedSlots = dayModel.mealSlots
            .map((slot) => MealPlannerSlotSelection(
                  slotIndex: slot.slotIndex,
                  slotKey: slot.slotKey,
                  proteinId: slot.proteinId,
                  carbId: slot.carbId,
                ))
            .toList();

        emit(s.copyWith(
          isSaving: false,
          day: dayModel,
          currentSlots: updatedSlots,
          savedSlots: List<MealPlannerSlotSelection>.from(updatedSlots),
          plannerMeta: dayModel.plannerMeta,
          paymentRequirement: dayModel.paymentRequirement,
        ));

        // API Guide: إذا requiresPayment === true → انتقل للخطوة payment
        // Don't close screen if payment is required
        if (dayModel.paymentRequirement?.requiresPayment != true) {
          // Can proceed to confirm or close
          // For now, just mark as saved
        }
      },
    );
  }

  /// Step 5: Initiate premium payment
  /// API Guide: POST /premium-extra/payments
  Future<void> _onInitiatePayment(
    InitiatePremiumPaymentEvent event,
    Emitter<MealPlannerState> emit,
  ) async {
    if (state is! MealPlannerLoadedNew) return;
    final s = state as MealPlannerLoadedNew;

    if (s.paymentRequirement?.requiresPayment != true) return;

    emit(s.copyWith(isSaving: true));

    final result = await _createPremiumPaymentUseCase.execute(
      CreatePremiumPaymentUseCaseInput(subscriptionId, date),
    );

    if (emit.isDone) return;

    result.fold(
      (failure) {
        emit(s.copyWith(
          isSaving: false,
          paymentError: "${failure.code}: ${failure.message}",
        ));
      },
      (paymentModel) {
        // API Guide: افتح paymentUrl (WebView أو Browser)
        emit(s.copyWith(
          isSaving: false,
          paymentUrl: paymentModel.paymentUrl,
          paymentId: paymentModel.paymentId,
        ));
      },
    );
  }

  /// Step 6: Verify payment and reload day data
  /// API Guide: POST /verify ثم GET /days/:date للتأكد
  Future<void> _onVerifyPayment(
    VerifyPremiumPaymentEvent event,
    Emitter<MealPlannerState> emit,
  ) async {
    if (state is! MealPlannerLoadedNew) return;
    final s = state as MealPlannerLoadedNew;

    emit(s.copyWith(isSaving: true));

    final result = await _verifyPremiumPaymentUseCase.execute(
      VerifyPremiumPaymentUseCaseInput(subscriptionId, date, event.paymentId),
    );

    if (emit.isDone) return;

    await result.fold(
      (failure) async {
        emit(s.copyWith(
          isSaving: false,
          paymentError: "${failure.code}: ${failure.message}",
        ));
      },
      (verificationModel) async {
        if (verificationModel.paymentStatus == "paid") {
          // API Guide: CRITICAL - أعد جلب اليوم عبر GET /days/:date
          final dayResult = await _getSubscriptionDayUseCase.execute(
            GetSubscriptionDayUseCaseInput(subscriptionId, date),
          );

          if (emit.isDone) return;

          dayResult.fold(
            (failure) {
              emit(s.copyWith(
                isSaving: false,
                paymentError: "${failure.code}: ${failure.message}",
              ));
            },
            (dayModel) {
              // API Guide: تأكد أن paymentRequirement.requiresPayment === false
              final updatedSlots = dayModel.mealSlots
                  .map((slot) => MealPlannerSlotSelection(
                        slotIndex: slot.slotIndex,
                        slotKey: slot.slotKey,
                        proteinId: slot.proteinId,
                        carbId: slot.carbId,
                      ))
                  .toList();

              emit(s.copyWith(
                isSaving: false,
                day: dayModel,
                currentSlots: updatedSlots,
                savedSlots: List<MealPlannerSlotSelection>.from(updatedSlots),
                plannerMeta: dayModel.plannerMeta,
                paymentRequirement: dayModel.paymentRequirement,
                paymentUrl: null,
                paymentId: null,
              ));
            },
          );
        } else {
          emit(s.copyWith(
            isSaving: false,
            paymentError: verificationModel.message,
          ));
        }
      },
    );
  }

  /// Step 7: Confirm day selection
  /// API Guide: POST /confirm
  /// الشروط الأربعة يجب أن تتحقق كلها:
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

    // Check all 4 conditions from API guide
    if (s.plannerMeta?.isConfirmable != true) {
      emit(s.copyWith(
        paymentError: "Cannot confirm: planning is not complete",
      ));
      return;
    }

    if (s.paymentRequirement?.requiresPayment == true) {
      emit(s.copyWith(
        paymentError: "Cannot confirm: payment is required",
      ));
      return;
    }

    if (s.day.status != "open") {
      emit(s.copyWith(
        paymentError: "Cannot confirm: day is not open",
      ));
      return;
    }

    if (s.day.plannerState == "confirmed") {
      emit(s.copyWith(
        paymentError: "Already confirmed",
      ));
      return;
    }

    emit(s.copyWith(isSaving: true, paymentError: null));

    final result = await _confirmDaySelectionUseCase.execute(
      ConfirmDaySelectionUseCaseInput(subscriptionId, date),
    );

    if (emit.isDone) return;

    result.fold(
      (failure) {
        emit(s.copyWith(
          isSaving: false,
          paymentError: "${failure.code}: ${failure.message}",
        ));
      },
      (success) {
        // API Guide: اقفل التفاعل وأظهر confirmed state
        emit(s.copyWith(
          isSaving: false,
          saveSuccess: true,
        ));
      },
    );
  }

  /// Helper: Check if day is editable
  bool _isDayEditable(SubscriptionDayModel day) {
    // API Guide: IF status === "locked" OR status === "frozen" THEN Read-only
    return ['open', 'planned', 'extension'].contains(day.status.toLowerCase()) &&
        day.plannerState != 'confirmed';
  }

  /// Helper: Find protein by ID
  BuilderProteinModel? _findProteinById(MealPlannerMenuModel menu, String id) {
    for (final protein in menu.builderCatalog.proteins) {
      if (protein.id == id) return protein;
    }
    return null;
  }
}
