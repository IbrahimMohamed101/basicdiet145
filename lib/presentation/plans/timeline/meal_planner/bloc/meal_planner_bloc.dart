import 'package:basic_diet/data/network/failure.dart';
import 'package:basic_diet/data/request/day_selection_request.dart';
import 'package:basic_diet/domain/model/current_subscription_overview_model.dart';
import 'package:basic_diet/domain/model/meal_planner_menu_model.dart';
import 'package:basic_diet/domain/model/subscription_day_model.dart';
import 'package:basic_diet/domain/model/timeline_model.dart';
import 'package:basic_diet/domain/usecase/confirm_day_selection_usecase.dart';
import 'package:basic_diet/domain/usecase/create_one_time_addon_payment_usecase.dart';
import 'package:basic_diet/domain/usecase/create_premium_payment_usecase.dart';
import 'package:basic_diet/domain/usecase/get_addons_usecase.dart';
import 'package:basic_diet/domain/usecase/get_meal_planner_menu_usecase.dart';
import 'package:basic_diet/domain/usecase/get_subscription_day_usecase.dart';
import 'package:basic_diet/domain/usecase/save_day_selection_usecase.dart';
import 'package:basic_diet/domain/usecase/verify_one_time_addon_payment_usecase.dart';
import 'package:basic_diet/domain/usecase/verify_premium_payment_usecase.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import 'meal_planner_event.dart';
import 'meal_planner_state.dart';

class MealPlannerBloc extends Bloc<MealPlannerEvent, MealPlannerState> {
  final GetMealPlannerMenuUseCase _getMealPlannerMenuUseCase;
  final GetSubscriptionDayUseCase _getSubscriptionDayUseCase;
  final GetAddOnsUseCase _getAddOnsUseCase;
  final SaveDaySelectionUseCase _saveDaySelectionUseCase;
  final CreatePremiumPaymentUseCase _createPremiumPaymentUseCase;
  final VerifyPremiumPaymentUseCase _verifyPremiumPaymentUseCase;
  final CreateOneTimeAddonPaymentUseCase _createOneTimeAddonPaymentUseCase;
  final VerifyOneTimeAddonPaymentUseCase _verifyOneTimeAddonPaymentUseCase;
  final ConfirmDaySelectionUseCase _confirmDaySelectionUseCase;
  final List<TimelineDayModel> initialTimelineDays;
  final List<AddonSubscriptionModel> addonEntitlements;
  final int initialDayIndex;
  final int premiumMealsRemaining;
  final String subscriptionId;

  MealPlannerBloc(
    this._getMealPlannerMenuUseCase,
    this._getSubscriptionDayUseCase,
    this._getAddOnsUseCase,
    this._saveDaySelectionUseCase,
    this._createPremiumPaymentUseCase,
    this._verifyPremiumPaymentUseCase,
    this._createOneTimeAddonPaymentUseCase,
    this._verifyOneTimeAddonPaymentUseCase,
    this._confirmDaySelectionUseCase, {
    required this.initialTimelineDays,
    required this.addonEntitlements,
    required this.initialDayIndex,
    required this.premiumMealsRemaining,
    required this.subscriptionId,
  }) : super(MealPlannerInitial()) {
    on<GetMealPlannerDataEvent>(_onGetData);
    on<ChangeDateEvent>(_onChangeDate);
    on<RetrySelectedDayLoadEvent>(_onRetrySelectedDayLoad);
    on<SetMealSlotProteinEvent>(_onSetProtein);
    on<SetMealSlotCarbEvent>(_onSetCarb);
    on<ToggleAddOnSelectionEvent>(_onToggleAddonSelection);
    on<SelectAddonForCategoryEvent>(_onSelectAddonForCategory);
    on<DismissPendingAddonPromptEvent>(_onDismissPendingAddonPrompt);
    on<SaveMealPlannerChangesEvent>(_onSave);
    on<HideBannerEvent>(_onHideBanner);
    on<InitiatePremiumPaymentEvent>(_onInitiatePremiumPayment);
    on<VerifyPremiumPaymentEvent>(_onVerifyPremiumPayment);
    on<InitiateAddonPaymentEvent>(_onInitiateAddonPayment);
    on<VerifyAddonPaymentEvent>(_onVerifyAddonPayment);
  }

  Future<void> _onGetData(
    GetMealPlannerDataEvent event,
    Emitter<MealPlannerState> emit,
  ) async {
    emit(MealPlannerLoading());

    final menuResult = await _getMealPlannerMenuUseCase.execute(null);
    final addonsResult = await _getAddOnsUseCase.execute(null);

    final menuFailure = menuResult.fold((failure) => failure, (_) => null);
    if (menuFailure != null) {
      emit(MealPlannerError("${menuFailure.code}: ${menuFailure.message}"));
      return;
    }

    final addonsFailure = addonsResult.fold((failure) => failure, (_) => null);
    if (addonsFailure != null) {
      emit(MealPlannerError("${addonsFailure.code}: ${addonsFailure.message}"));
      return;
    }

    final menu = menuResult.getOrElse(() => throw Exception());
    final addOnsCatalog =
        addonsResult.getOrElse(() => throw Exception()).addOns;

    final slotsByDay = <int, List<MealPlannerSlotSelection>>{};
    final savedSlotsByDay = <int, List<MealPlannerSlotSelection>>{};
    final selectedAddOnIdsByDay = <int, List<String>>{};
    final savedAddOnIdsByDay = <int, List<String>>{};

    for (int dayIndex = 0; dayIndex < initialTimelineDays.length; dayIndex++) {
      final slots = _buildSlotsFromTimelineDay(initialTimelineDays[dayIndex]);
      slotsByDay[dayIndex] = slots;
      savedSlotsByDay[dayIndex] = List<MealPlannerSlotSelection>.from(slots);
      selectedAddOnIdsByDay[dayIndex] = const [];
      savedAddOnIdsByDay[dayIndex] = const [];
    }

    final initialState = MealPlannerLoaded(
      timelineDays: initialTimelineDays,
      menu: menu,
      addOnsCatalog: addOnsCatalog,
      addonEntitlements: addonEntitlements,
      selectedDayIndex: initialDayIndex,
      selectedSlotsPerDay: slotsByDay,
      savedSlotsPerDay: savedSlotsByDay,
      selectedAddOnIdsByDay: selectedAddOnIdsByDay,
      savedAddOnIdsByDay: savedAddOnIdsByDay,
      dayDetailsByIndex: const {},
      premiumMealsRemaining: premiumMealsRemaining,
    );

    emit(initialState.copyWith(isRefreshingDay: true));
    await _loadDayDetails(emit, initialState, initialDayIndex);
  }

  Future<void> _onChangeDate(
    ChangeDateEvent event,
    Emitter<MealPlannerState> emit,
  ) async {
    if (state is! MealPlannerLoaded) return;
    final current = state as MealPlannerLoaded;
    final next = current.copyWith(
      selectedDayIndex: event.index,
      isRefreshingDay: !current.dayDetailsByIndex.containsKey(event.index),
      clearPaymentError: true,
      clearPendingAddonPrompt: true,
    );
    emit(next);

    if (!next.dayDetailsByIndex.containsKey(event.index)) {
      await _loadDayDetails(emit, next, event.index);
      return;
    }

    emit(
      next.copyWith(
        premiumMealsPendingPayment: _currentPremiumPendingCount(next),
      ),
    );
  }

  Future<void> _onRetrySelectedDayLoad(
    RetrySelectedDayLoadEvent event,
    Emitter<MealPlannerState> emit,
  ) async {
    if (state is! MealPlannerLoaded) return;
    final current = state as MealPlannerLoaded;
    emit(current.copyWith(isRefreshingDay: true, clearPaymentError: true));
    await _loadDayDetails(emit, current, current.selectedDayIndex, force: true);
  }

  void _onSetProtein(
    SetMealSlotProteinEvent event,
    Emitter<MealPlannerState> emit,
  ) {
    if (state is! MealPlannerLoaded) return;
    final current = state as MealPlannerLoaded;
    if (!current.isSelectedDayEditable) {
      emit(
        current.copyWith(
          paymentError: 'DAY_LOCKED',
          clearPendingAddonPrompt: true,
        ),
      );
      return;
    }

    final dayIndex = current.selectedDayIndex;
    final slots = List<MealPlannerSlotSelection>.from(
      current.selectedSlotsPerDay[dayIndex] ?? const [],
    );
    if (event.slotIndex < 0 || event.slotIndex >= slots.length) return;

    final previous = slots[event.slotIndex];
    if (previous.proteinId == event.proteinId) return;

    slots[event.slotIndex] = previous.copyWith(
      proteinId: event.proteinId,
      carbId: event.proteinId == null ? null : previous.carbId,
    );

    final updatedSlotsByDay = Map<int, List<MealPlannerSlotSelection>>.from(
      current.selectedSlotsPerDay,
    )..[dayIndex] = slots;

    String proteinName = '';
    if (event.proteinId != null) {
      proteinName =
          _findProteinById(current.menu, event.proteinId!)?.name ?? '';
    }

    final next = current.copyWith(
      selectedSlotsPerDay: updatedSlotsByDay,
      showSavedBanner: event.proteinId != null,
      lastAddedMealName:
          proteinName.isNotEmpty ? proteinName : current.lastAddedMealName,
      premiumMealsPendingPayment: _calculatePendingPaymentCount(
        current,
        selectedSlotsPerDay: updatedSlotsByDay,
      ),
      clearPaymentError: true,
    );
    emit(next);
  }

  void _onSetCarb(SetMealSlotCarbEvent event, Emitter<MealPlannerState> emit) {
    if (state is! MealPlannerLoaded) return;
    final current = state as MealPlannerLoaded;
    if (!current.isSelectedDayEditable) {
      emit(current.copyWith(paymentError: 'DAY_LOCKED'));
      return;
    }

    final dayIndex = current.selectedDayIndex;
    final slots = List<MealPlannerSlotSelection>.from(
      current.selectedSlotsPerDay[dayIndex] ?? const [],
    );
    if (event.slotIndex < 0 || event.slotIndex >= slots.length) return;

    final previous = slots[event.slotIndex];
    if (previous.carbId == event.carbId) return;

    slots[event.slotIndex] = previous.copyWith(carbId: event.carbId);

    final updatedSlotsByDay = Map<int, List<MealPlannerSlotSelection>>.from(
      current.selectedSlotsPerDay,
    )..[dayIndex] = slots;

    emit(
      current.copyWith(
        selectedSlotsPerDay: updatedSlotsByDay,
        premiumMealsPendingPayment: _calculatePendingPaymentCount(
          current,
          selectedSlotsPerDay: updatedSlotsByDay,
        ),
        clearPaymentError: true,
      ),
    );
  }

  void _onToggleAddonSelection(
    ToggleAddOnSelectionEvent event,
    Emitter<MealPlannerState> emit,
  ) {
    if (state is! MealPlannerLoaded) return;
    final current = state as MealPlannerLoaded;
    if (!current.isSelectedDayEditable) {
      emit(current.copyWith(paymentError: 'DAY_LOCKED'));
      return;
    }

    final currentIds = List<String>.from(current.selectedAddOnIds);
    if (currentIds.contains(event.addOn.id)) {
      currentIds.remove(event.addOn.id);
    } else {
      currentIds.add(event.addOn.id);
    }

    final updatedSelections = Map<int, List<String>>.from(
      current.selectedAddOnIdsByDay,
    )..[current.selectedDayIndex] = currentIds;

    emit(
      current.copyWith(
        selectedAddOnIdsByDay: updatedSelections,
        clearPendingAddonPrompt: true,
        clearPaymentError: true,
      ),
    );
  }

  void _onSelectAddonForCategory(
    SelectAddonForCategoryEvent event,
    Emitter<MealPlannerState> emit,
  ) {
    if (state is! MealPlannerLoaded) return;
    final current = state as MealPlannerLoaded;
    if (!current.isSelectedDayEditable) {
      emit(current.copyWith(paymentError: 'DAY_LOCKED'));
      return;
    }

    // Collect all addon IDs that belong to this category
    final categoryAddonIds =
        current.addOnsCatalog
            .where((a) => a.category == event.category)
            .map((a) => a.id)
            .toSet();

    // Remove any existing selection for this category
    final currentIds = List<String>.from(current.selectedAddOnIds)
      ..removeWhere((id) => categoryAddonIds.contains(id));

    // Add the new selection if non-null
    if (event.addonId != null) {
      currentIds.add(event.addonId!);
    }

    final updatedSelections = Map<int, List<String>>.from(
      current.selectedAddOnIdsByDay,
    )..[current.selectedDayIndex] = currentIds;

    emit(
      current.copyWith(
        selectedAddOnIdsByDay: updatedSelections,
        clearPendingAddonPrompt: true,
        clearPaymentError: true,
      ),
    );
  }

  void _onDismissPendingAddonPrompt(
    DismissPendingAddonPromptEvent event,
    Emitter<MealPlannerState> emit,
  ) {
    if (state is! MealPlannerLoaded) return;
    emit((state as MealPlannerLoaded).copyWith(clearPendingAddonPrompt: true));
  }

  Future<void> _onSave(
    SaveMealPlannerChangesEvent event,
    Emitter<MealPlannerState> emit,
  ) async {
    if (state is! MealPlannerLoaded) return;
    final current = state as MealPlannerLoaded;
    await _saveAndMaybeContinue(emit, current);
  }

  void _onHideBanner(HideBannerEvent event, Emitter<MealPlannerState> emit) {
    if (state is! MealPlannerLoaded) return;
    emit((state as MealPlannerLoaded).copyWith(showSavedBanner: false));
  }

  Future<void> _onInitiatePremiumPayment(
    InitiatePremiumPaymentEvent event,
    Emitter<MealPlannerState> emit,
  ) async {
    if (state is! MealPlannerLoaded) return;
    final current = state as MealPlannerLoaded;
    await _saveAndMaybeContinue(emit, current, paymentKind: 'premium');
  }

  Future<void> _onVerifyPremiumPayment(
    VerifyPremiumPaymentEvent event,
    Emitter<MealPlannerState> emit,
  ) async {
    await _verifyPayment(emit, event.paymentId, kind: 'premium');
  }

  Future<void> _onInitiateAddonPayment(
    InitiateAddonPaymentEvent event,
    Emitter<MealPlannerState> emit,
  ) async {
    if (state is! MealPlannerLoaded) return;
    final current = state as MealPlannerLoaded;
    await _saveAndMaybeContinue(emit, current, paymentKind: 'addons');
  }

  Future<void> _onVerifyAddonPayment(
    VerifyAddonPaymentEvent event,
    Emitter<MealPlannerState> emit,
  ) async {
    await _verifyPayment(emit, event.paymentId, kind: 'addons');
  }

  Future<void> _loadDayDetails(
    Emitter<MealPlannerState> emit,
    MealPlannerLoaded baseState,
    int dayIndex, {
    bool force = false,
  }) async {
    if (!force && baseState.dayDetailsByIndex.containsKey(dayIndex)) {
      emit(
        baseState.copyWith(
          isRefreshingDay: false,
          premiumMealsPendingPayment: _currentPremiumPendingCount(baseState),
        ),
      );
      return;
    }

    final day = baseState.timelineDays[dayIndex];
    final result = await _getSubscriptionDayUseCase.execute(
      GetSubscriptionDayUseCaseInput(subscriptionId, day.date),
    );

    result.fold(
      (failure) {
        if (!emit.isDone) {
          emit(
            baseState.copyWith(
              isRefreshingDay: false,
              paymentError: "${failure.code}: ${failure.message}",
            ),
          );
        }
      },
      (dayDetail) {
        if (emit.isDone) return;

        final dayDetailsByIndex = Map<int, SubscriptionDayModel>.from(
          baseState.dayDetailsByIndex,
        )..[dayIndex] = dayDetail;

        final selectedSlotsPerDay =
            Map<int, List<MealPlannerSlotSelection>>.from(
                baseState.selectedSlotsPerDay,
              )
              ..[dayIndex] = _buildSlotsFromSubscriptionDay(
                dayDetail,
                day.requiredMeals,
              );

        final savedSlotsPerDay = Map<int, List<MealPlannerSlotSelection>>.from(
            baseState.savedSlotsPerDay,
          )
          ..[dayIndex] = List<MealPlannerSlotSelection>.from(
            selectedSlotsPerDay[dayIndex] ?? const [],
          );

        final addonIds =
            dayDetail.addonSelections
                .map((selection) => selection.addonId)
                .where((id) => id.isNotEmpty)
                .toList();

        final selectedAddOnIdsByDay = Map<int, List<String>>.from(
          baseState.selectedAddOnIdsByDay,
        )..[dayIndex] = addonIds;

        final savedAddOnIdsByDay = Map<int, List<String>>.from(
          baseState.savedAddOnIdsByDay,
        )..[dayIndex] = List<String>.from(addonIds);

        final next = baseState.copyWith(
          selectedDayIndex: dayIndex,
          dayDetailsByIndex: dayDetailsByIndex,
          selectedSlotsPerDay: selectedSlotsPerDay,
          savedSlotsPerDay: savedSlotsPerDay,
          selectedAddOnIdsByDay: selectedAddOnIdsByDay,
          savedAddOnIdsByDay: savedAddOnIdsByDay,
          isRefreshingDay: false,
          premiumMealsPendingPayment:
              dayDetail.paymentRequirement?.premiumPendingPaymentCount ??
              _calculatePendingPaymentCount(
                baseState.copyWith(
                  selectedSlotsPerDay: selectedSlotsPerDay,
                  dayDetailsByIndex: dayDetailsByIndex,
                ),
              ),
          clearPaymentError: true,
        );
        emit(next);
      },
    );
  }

  Future<void> _saveAndMaybeContinue(
    Emitter<MealPlannerState> emit,
    MealPlannerLoaded current, {
    String? paymentKind,
  }) async {
    if (!current.isSelectedDayEditable) {
      emit(current.copyWith(paymentError: 'DAY_LOCKED'));
      return;
    }

    final currentDay = current.selectedTimelineDay;
    final slots = current.selectedSlotsPerDay[current.selectedDayIndex] ?? [];
    final completeSlots =
        slots
            .where((slot) => slot.proteinId != null && slot.carbId != null)
            .toList();

    if (completeSlots.length < currentDay.requiredMeals) {
      emit(
        current.copyWith(
          paymentError:
              "Please complete all required meals (${completeSlots.length}/${currentDay.requiredMeals})",
        ),
      );
      return;
    }

    emit(
      current.copyWith(
        isSaving: true,
        saveSuccess: false,
        clearPaymentError: true,
        clearPendingAddonPrompt: true,
      ),
    );

    final request = DaySelectionRequest(
      completeSlots
          .map(
            (slot) => MealSlotRequest(
              slotIndex: slot.slotIndex,
              proteinId: slot.proteinId,
              carbId: slot.carbId,
            ),
          )
          .toList(),
      addonsOneTime: current.selectedAddOnIds,
    );

    final result = await _saveDaySelectionUseCase.execute(
      SaveDaySelectionUseCaseInput(subscriptionId, currentDay.date, request),
    );

    await result.fold(
      (failure) async {
        if (!emit.isDone) {
          emit(
            current.copyWith(
              isSaving: false,
              paymentError: "${failure.code}: ${failure.message}",
            ),
          );
        }
      },
      (updatedDay) async {
        if (emit.isDone) return;

        final updatedState = _applyUpdatedDay(current, updatedDay);

        if (paymentKind == 'premium') {
          await _createPremiumPayment(emit, updatedState);
          return;
        }

        if (paymentKind == 'addons') {
          await _createAddonPayment(emit, updatedState);
          return;
        }

        final requiresPayment =
            updatedDay.paymentRequirement?.requiresPayment ?? false;
        if (requiresPayment) {
          emit(updatedState.copyWith(isSaving: false, saveSuccess: false));
          return;
        }

        final confirmError = await _confirmSelection(date: currentDay.date);
        if (confirmError != null) {
          emit(
            updatedState.copyWith(
              isSaving: false,
              paymentError: "${confirmError.code}: ${confirmError.message}",
            ),
          );
          return;
        }

        emit(
          updatedState.copyWith(
            isSaving: false,
            saveSuccess: true,
            premiumMealsPendingPayment: 0,
          ),
        );
      },
    );
  }

  Future<void> _createPremiumPayment(
    Emitter<MealPlannerState> emit,
    MealPlannerLoaded stateAfterSave,
  ) async {
    final premiumPending =
        stateAfterSave
            .selectedDayDetail
            ?.paymentRequirement
            ?.premiumPendingPaymentCount ??
        stateAfterSave.premiumMealsPendingPayment;
    if (premiumPending <= 0) {
      emit(
        stateAfterSave.copyWith(
          isSaving: false,
          paymentError: 'No pending premium payment found',
        ),
      );
      return;
    }

    final day = stateAfterSave.selectedTimelineDay;
    final paymentResult = await _createPremiumPaymentUseCase.execute(
      CreatePremiumPaymentUseCaseInput(subscriptionId, day.date),
    );

    paymentResult.fold(
      (failure) {
        if (!emit.isDone) {
          emit(
            stateAfterSave.copyWith(
              isSaving: false,
              paymentError: "${failure.code}: ${failure.message}",
            ),
          );
        }
      },
      (paymentModel) {
        if (!emit.isDone) {
          emit(
            stateAfterSave.copyWith(
              isSaving: false,
              paymentUrl: paymentModel.paymentUrl,
              paymentId: paymentModel.paymentId,
              activePaymentKind: 'premium',
            ),
          );
        }
      },
    );
  }

  Future<void> _createAddonPayment(
    Emitter<MealPlannerState> emit,
    MealPlannerLoaded stateAfterSave,
  ) async {
    final addonPending =
        stateAfterSave
            .selectedDayDetail
            ?.paymentRequirement
            ?.addonPendingPaymentCount ??
        0;
    if (addonPending <= 0) {
      emit(
        stateAfterSave.copyWith(
          isSaving: false,
          paymentError: 'No pending add-on payment found',
        ),
      );
      return;
    }

    final day = stateAfterSave.selectedTimelineDay;
    final paymentResult = await _createOneTimeAddonPaymentUseCase.execute(
      CreateOneTimeAddonPaymentUseCaseInput(subscriptionId, day.date),
    );

    paymentResult.fold(
      (failure) {
        if (!emit.isDone) {
          emit(
            stateAfterSave.copyWith(
              isSaving: false,
              paymentError: "${failure.code}: ${failure.message}",
            ),
          );
        }
      },
      (paymentModel) {
        if (!emit.isDone) {
          emit(
            stateAfterSave.copyWith(
              isSaving: false,
              paymentUrl: paymentModel.paymentUrl,
              paymentId: paymentModel.paymentId,
              activePaymentKind: 'addons',
            ),
          );
        }
      },
    );
  }

  Future<void> _verifyPayment(
    Emitter<MealPlannerState> emit,
    String paymentId, {
    required String kind,
  }) async {
    if (state is! MealPlannerLoaded) return;
    final current = state as MealPlannerLoaded;

    emit(
      current.copyWith(
        isSaving: true,
        saveSuccess: false,
        clearPaymentError: true,
      ),
    );

    final day = current.selectedTimelineDay;
    final result =
        kind == 'premium'
            ? await _verifyPremiumPaymentUseCase.execute(
              VerifyPremiumPaymentUseCaseInput(
                subscriptionId,
                day.date,
                paymentId,
              ),
            )
            : await _verifyOneTimeAddonPaymentUseCase.execute(
              VerifyOneTimeAddonPaymentUseCaseInput(
                subscriptionId,
                day.date,
                paymentId,
              ),
            );

    final verificationFailure = result.fold((failure) => failure, (_) => null);
    if (verificationFailure != null) {
      emit(
        current.copyWith(
          isSaving: false,
          paymentError:
              "${verificationFailure.code}: ${verificationFailure.message}",
        ),
      );
      return;
    }

    final verificationModel = result.getOrElse(() => throw Exception());
    if (verificationModel.paymentStatus != 'paid') {
      emit(
        current.copyWith(
          isSaving: false,
          paymentError: verificationModel.message,
        ),
      );
      return;
    }

    final refreshed = await _getSubscriptionDayUseCase.execute(
      GetSubscriptionDayUseCaseInput(subscriptionId, day.date),
    );

    await refreshed.fold(
      (failure) async {
        emit(
          current.copyWith(
            isSaving: false,
            paymentError: "${failure.code}: ${failure.message}",
          ),
        );
      },
      (updatedDay) async {
        final updatedState = _applyUpdatedDay(current, updatedDay).copyWith(
          isSaving: false,
          clearPaymentUrl: true,
          clearPaymentId: true,
          activePaymentKind: kind,
        );

        final stillRequiresPayment =
            updatedDay.paymentRequirement?.requiresPayment ?? false;

        if (kind == 'premium' && updatedState.hasPendingAddonPayment) {
          await _createAddonPayment(emit, updatedState);
          return;
        }

        if (kind == 'addons' && updatedState.hasPendingPremiumPayment) {
          await _createPremiumPayment(emit, updatedState);
          return;
        }

        if (stillRequiresPayment) {
          emit(updatedState);
          return;
        }

        final confirmError = await _confirmSelection(date: day.date);
        if (confirmError != null) {
          emit(
            updatedState.copyWith(
              paymentError: "${confirmError.code}: ${confirmError.message}",
            ),
          );
          return;
        }

        emit(
          updatedState.copyWith(
            saveSuccess: true,
            premiumMealsPendingPayment: 0,
          ),
        );
      },
    );
  }

  MealPlannerLoaded _applyUpdatedDay(
    MealPlannerLoaded state,
    SubscriptionDayModel updatedDay,
  ) {
    final dayIndex = state.selectedDayIndex;
    final newSlots = _buildSlotsFromSubscriptionDay(
      updatedDay,
      state.selectedTimelineDay.requiredMeals,
    );
    final addonIds =
        updatedDay.addonSelections
            .map((selection) => selection.addonId)
            .where((id) => id.isNotEmpty)
            .toList();

    return state.copyWith(
      selectedSlotsPerDay: Map<int, List<MealPlannerSlotSelection>>.from(
        state.selectedSlotsPerDay,
      )..[dayIndex] = newSlots,
      savedSlotsPerDay: Map<int, List<MealPlannerSlotSelection>>.from(
        state.savedSlotsPerDay,
      )..[dayIndex] = List<MealPlannerSlotSelection>.from(newSlots),
      selectedAddOnIdsByDay: Map<int, List<String>>.from(
        state.selectedAddOnIdsByDay,
      )..[dayIndex] = addonIds,
      savedAddOnIdsByDay: Map<int, List<String>>.from(state.savedAddOnIdsByDay)
        ..[dayIndex] = List<String>.from(addonIds),
      dayDetailsByIndex: Map<int, SubscriptionDayModel>.from(
        state.dayDetailsByIndex,
      )..[dayIndex] = updatedDay,
      premiumMealsPendingPayment:
          updatedDay.paymentRequirement?.premiumPendingPaymentCount ?? 0,
      clearPaymentError: true,
      clearPendingAddonPrompt: true,
    );
  }

  List<MealPlannerSlotSelection> _buildSlotsFromTimelineDay(
    TimelineDayModel day,
  ) {
    if (day.mealSlots.isNotEmpty) {
      return List.generate(day.requiredMeals, (index) {
        final slot = index < day.mealSlots.length ? day.mealSlots[index] : null;
        return MealPlannerSlotSelection(
          slotIndex: index + 1,
          slotKey: 'slot_${index + 1}',
          proteinId: slot?.proteinId,
          carbId: slot?.carbId,
        );
      });
    }

    final selections = [...day.selections, ...day.premiumSelections];
    return List.generate(day.requiredMeals, (index) {
      return MealPlannerSlotSelection(
        slotIndex: index + 1,
        slotKey: 'slot_${index + 1}',
        proteinId: index < selections.length ? selections[index] : null,
        carbId: null,
      );
    });
  }

  List<MealPlannerSlotSelection> _buildSlotsFromSubscriptionDay(
    SubscriptionDayModel day,
    int requiredMeals,
  ) {
    return List.generate(requiredMeals, (index) {
      final slot = index < day.mealSlots.length ? day.mealSlots[index] : null;
      return MealPlannerSlotSelection(
        slotIndex: index + 1,
        slotKey: slot?.slotKey ?? 'slot_${index + 1}',
        proteinId: slot?.proteinId,
        carbId: slot?.carbId,
      );
    });
  }

  BuilderProteinModel? _findProteinById(MealPlannerMenuModel menu, String id) {
    for (final protein in menu.builderCatalog.proteins) {
      if (protein.id == id) return protein;
    }
    return null;
  }

  int _calculatePendingPaymentCount(
    MealPlannerLoaded state, {
    Map<int, List<MealPlannerSlotSelection>>? selectedSlotsPerDay,
  }) {
    final slotsPerDay = selectedSlotsPerDay ?? state.selectedSlotsPerDay;
    final daySlots = slotsPerDay[state.selectedDayIndex] ?? const [];

    var usedCredits = 0;
    for (final slot in daySlots) {
      final proteinId = slot.proteinId;
      if (proteinId == null) continue;
      final protein = _findProteinById(state.menu, proteinId);
      if (protein == null || !protein.isPremium) continue;
      usedCredits +=
          protein.premiumCreditCost == 0 ? 1 : protein.premiumCreditCost;
    }

    final pending = usedCredits - state.premiumMealsRemaining;
    return pending > 0 ? pending : 0;
  }

  int _currentPremiumPendingCount(MealPlannerLoaded state) {
    return state
            .selectedDayDetail
            ?.paymentRequirement
            ?.premiumPendingPaymentCount ??
        _calculatePendingPaymentCount(state);
  }

  Future<Failure?> _confirmSelection({required String date}) async {
    final confirmResult = await _confirmDaySelectionUseCase.execute(
      ConfirmDaySelectionUseCaseInput(subscriptionId, date),
    );

    return confirmResult.fold((failure) => failure, (_) => null);
  }
}
