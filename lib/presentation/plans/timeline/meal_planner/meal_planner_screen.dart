import 'package:basic_diet/app/dependency_injection.dart';
import 'package:basic_diet/domain/model/current_subscription_overview_model.dart';
import 'package:basic_diet/domain/model/meal_planner_menu_model.dart';
import 'package:basic_diet/domain/model/timeline_model.dart';
import 'package:basic_diet/presentation/main/home/payment-success/payment_webview_screen.dart';
import 'package:basic_diet/presentation/plans/timeline/meal_planner/bloc/meal_planner_bloc.dart';
import 'package:basic_diet/presentation/plans/timeline/meal_planner/bloc/meal_planner_event.dart';
import 'package:basic_diet/presentation/plans/timeline/meal_planner/bloc/meal_planner_state.dart';
import 'package:basic_diet/presentation/plans/timeline/meal_planner/widgets/meal_planner_bottom_action.dart';
import 'package:basic_diet/presentation/plans/timeline/meal_planner/widgets/meal_planner_date_selector.dart';
import 'package:basic_diet/presentation/plans/timeline/meal_planner/widgets/meal_planner_header.dart';
import 'package:basic_diet/presentation/plans/timeline/meal_planner/widgets/meal_planner_notification_banner.dart';
import 'package:basic_diet/presentation/plans/timeline/meal_planner/widgets/meal_planner_progress_indicator.dart';
import 'package:basic_diet/presentation/plans/timeline/meal_planner/widgets/daily_addon_selection_card.dart';
import 'package:basic_diet/presentation/plans/timeline/meal_planner/widgets/meal_slot_card.dart';
import 'package:basic_diet/presentation/plans/timeline/meal_planner/widgets/protein_picker_sheet.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';

class MealPlannerScreen extends StatelessWidget {
  final List<TimelineDayModel> timelineDays;
  final List<AddonSubscriptionModel> addonEntitlements;
  final int initialDayIndex;
  final int premiumMealsRemaining;
  final String subscriptionId;
  final bool readOnly;

  const MealPlannerScreen({
    super.key,
    required this.timelineDays,
    required this.addonEntitlements,
    required this.initialDayIndex,
    required this.premiumMealsRemaining,
    required this.subscriptionId,
    this.readOnly = false,
  });

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (context) {
        initMealPlannerModule();
        return instance<MealPlannerBloc>(
          param1: {
            'timelineDays': timelineDays,
            'addonEntitlements': addonEntitlements,
            'initialDayIndex': initialDayIndex,
            'premiumMealsRemaining': premiumMealsRemaining,
            'subscriptionId': subscriptionId,
          },
        )..add(const GetMealPlannerDataEvent());
      },
      child:
          readOnly
              ? const MealPlannerView(readOnly: true)
              : BlocListener<MealPlannerBloc, MealPlannerState>(
                listenWhen: (previous, current) {
                  if (previous is! MealPlannerLoaded ||
                      current is! MealPlannerLoaded) {
                    return false;
                  }

                  return (!previous.saveSuccess && current.saveSuccess) ||
                      (current.paymentUrl != null &&
                          (previous.paymentUrl != current.paymentUrl ||
                              previous.paymentId != current.paymentId)) ||
                      (current.paymentError != null &&
                          previous.paymentError != current.paymentError);
                },
                listener: (context, state) async {
                  if (state is! MealPlannerLoaded) return;

                  if (state.saveSuccess && state.paymentUrl == null) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: Text(Strings.changesSavedSuccessfully.tr()),
                        backgroundColor: ColorManager.stateSuccess,
                        duration: const Duration(seconds: 2),
                      ),
                    );
                    Navigator.pop(context, true);
                    return;
                  }

                  if (state.paymentUrl != null && state.paymentId != null) {
                    await _openPaymentWebView(
                      context,
                      state.paymentUrl!,
                      state.paymentId!,
                      state.activePaymentKind ?? 'premium',
                    );
                    return;
                  }

                  if (state.paymentError != null) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: Text(
                          _resolveErrorMessage(state.paymentError!),
                        ),
                        backgroundColor: ColorManager.stateError,
                      ),
                    );
                  }
                },
                child: const MealPlannerView(),
              ),
    );
  }

  String _resolveErrorMessage(String message) {
    if (message == 'DAY_LOCKED') {
      return Strings.dayLockedAddonsMessage.tr();
    }
    return message;
  }

  Future<void> _openPaymentWebView(
    BuildContext context,
    String paymentUrl,
    String paymentId,
    String paymentKind,
  ) async {
    final uri = Uri.tryParse(paymentUrl);
    if (uri == null || !uri.hasScheme) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(Strings.paymentNotCompleted.tr()),
          backgroundColor: ColorManager.stateError,
        ),
      );
      return;
    }

    final successUrl =
        paymentKind == 'addons'
            ? _addonPaymentSuccessUrl
            : _premiumPaymentSuccessUrl;
    final backUrl =
        paymentKind == 'addons'
            ? _addonPaymentCancelUrl
            : _premiumPaymentCancelUrl;

    final result = await Navigator.push<PaymentWebViewResult>(
      context,
      MaterialPageRoute(
        builder:
            (_) => PaymentWebViewScreen(
              paymentUrl: paymentUrl,
              draftId: paymentId,
              successUrl: successUrl,
              backUrl: backUrl,
              onSuccess: () => Navigator.of(context).pop(),
            ),
      ),
    );

    if (!context.mounted) return;

    if (result == PaymentWebViewResult.cancelled) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(Strings.paymentCancelled.tr())));
      return;
    }

    context.read<MealPlannerBloc>().add(
      paymentKind == 'addons'
          ? VerifyAddonPaymentEvent(paymentId)
          : VerifyPremiumPaymentEvent(paymentId),
    );
  }
}

const String _premiumPaymentSuccessUrl =
    'https://app.example.com/payments/premium/success';
const String _premiumPaymentCancelUrl =
    'https://app.example.com/payments/premium/cancel';
const String _addonPaymentSuccessUrl =
    'https://app.example.com/payments/one-time-addons/success';
const String _addonPaymentCancelUrl =
    'https://app.example.com/payments/one-time-addons/cancel';

class MealPlannerView extends StatelessWidget {
  final bool readOnly;

  const MealPlannerView({super.key, this.readOnly = false});

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<MealPlannerBloc, MealPlannerState>(
      builder: (context, state) {
        if (state is MealPlannerLoading) {
          return Scaffold(
            backgroundColor: ColorManager.backgroundSurface,
            body: Center(
              child: CircularProgressIndicator(
                color: ColorManager.brandPrimary,
              ),
            ),
          );
        }

        if (state is MealPlannerError) {
          return Scaffold(
            backgroundColor: ColorManager.backgroundSurface,
            body: Center(
              child: Padding(
                padding: EdgeInsets.all(AppPadding.p24.w),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      state.message,
                      textAlign: TextAlign.center,
                      style: getRegularTextStyle(
                        color: ColorManager.textSecondary,
                        fontSize: FontSizeManager.s14.sp,
                      ),
                    ),
                    Gap(AppSize.s16.h),
                    ElevatedButton(
                      onPressed:
                          () => context.read<MealPlannerBloc>().add(
                            const GetMealPlannerDataEvent(),
                          ),
                      child: Text(Strings.tryAgain.tr()),
                    ),
                  ],
                ),
              ),
            ),
          );
        }

        if (state is! MealPlannerLoaded) {
          return const SizedBox.shrink();
        }

        final isViewOnly = readOnly || !state.isSelectedDayEditable;

        return Scaffold(
          backgroundColor: ColorManager.backgroundSurface,
          bottomNavigationBar:
              !isViewOnly ? MealPlannerBottomAction(state: state) : null,
          body: SafeArea(
            child: _MealPlannerBody(state: state, readOnly: readOnly),
          ),
        );
      },
    );
  }
}

class _MealPlannerBody extends StatelessWidget {
  final MealPlannerLoaded state;
  final bool readOnly;

  const _MealPlannerBody({required this.state, required this.readOnly});

  @override
  Widget build(BuildContext context) {
    final isSelectedDayReadOnly = readOnly || !state.isSelectedDayEditable;

    return Stack(
      children: [
        CustomScrollView(
          slivers: [
            SliverToBoxAdapter(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const MealPlannerHeader(),
                  Gap(AppSize.s16.h),
                  MealPlannerDateSelector(state: state),
                  if (state.isRefreshingDay)
                    const LinearProgressIndicator(
                      color: ColorManager.brandPrimary,
                      backgroundColor: ColorManager.backgroundSubtle,
                    ),
                  Gap(AppSize.s16.h),
                ],
              ),
            ),
            SliverPadding(
              padding: EdgeInsets.symmetric(horizontal: AppPadding.p16.w),
              sliver: SliverToBoxAdapter(
                child: Column(
                  children: [
                    MealPlannerProgressIndicator(
                      selectedMeals: _selectedMealsCount(state),
                      totalMeals: state.maxMeals,
                      premiumLeft: _premiumLeftForDay(state),
                      premiumPending: state.premiumMealsPendingPayment,
                      paymentAmount: _premiumPaymentAmount(state),
                    ),
                    Gap(AppSize.s16.h),
                    DailyAddonSelectionCard(
                      state: state,
                      isReadOnly: isSelectedDayReadOnly,
                    ),
                    Gap(AppSize.s16.h),
                  ],
                ),
              ),
            ),
            SliverPadding(
              padding: EdgeInsets.only(
                left: AppPadding.p16.w,
                right: AppPadding.p16.w,
                bottom: AppPadding.p24.h,
              ),
              sliver: SliverList.separated(
                itemCount: state.maxMeals,
                separatorBuilder: (_, __) => Gap(AppSize.s12.h),
                itemBuilder:
                    (context, index) => _buildMealSlot(
                      context,
                      state,
                      index,
                      isSelectedDayReadOnly,
                    ),
              ),
            ),
          ],
        ),
        MealPlannerNotificationBanner(state: state),
      ],
    );
  }

  Widget _buildMealSlot(
    BuildContext context,
    MealPlannerLoaded state,
    int index,
    bool isReadOnly,
  ) {
    final slot = _slotForIndex(state, index);
    final protein =
        slot?.proteinId == null
            ? null
            : _findProteinById(state.menu, slot!.proteinId!);
    final carb =
        slot?.carbId == null ? null : _findCarbById(state.menu, slot!.carbId!);

    return MealSlotCard(
      slotNumber: index + 1,
      protein: protein,
      carb: carb,
      isProteinPremium: protein?.isPremium ?? false,
      onSelectProtein:
          isReadOnly
              ? null
              : () => _openProteinPickerSheet(
                context: context,
                state: state,
                slotIndex: index,
                selectedProteinId: slot?.proteinId,
              ),
      carbOptions: _sortedCarbs(state.menu),
      onCarbSelected:
          isReadOnly || protein == null
              ? null
              : (carbId) => context.read<MealPlannerBloc>().add(
                SetMealSlotCarbEvent(slotIndex: index, carbId: carbId),
              ),
      onClear:
          isReadOnly || protein == null
              ? null
              : () => context.read<MealPlannerBloc>().add(
                SetMealSlotProteinEvent(slotIndex: index, proteinId: null),
              ),
    );
  }

  int _selectedMealsCount(MealPlannerLoaded state) {
    final slots = state.selectedSlotsPerDay[state.selectedDayIndex] ?? [];
    return slots
        .where((slot) => slot.proteinId != null && slot.carbId != null)
        .length;
  }

  int _premiumLeftForDay(MealPlannerLoaded state) {
    final used = _premiumCreditsUsed(state);
    final left = state.premiumMealsRemaining - used;
    return left < 0 ? 0 : left;
  }

  double _premiumPaymentAmount(MealPlannerLoaded state) {
    var totalHalala = 0;
    var usedCredits = 0;
    final slots = state.selectedSlotsPerDay[state.selectedDayIndex] ?? const [];

    for (final slot in slots) {
      final proteinId = slot.proteinId;
      if (proteinId == null) continue;
      final protein = _findProteinById(state.menu, proteinId);
      if (protein == null || !protein.isPremium) continue;

      final cost =
          protein.premiumCreditCost == 0 ? 1 : protein.premiumCreditCost;
      usedCredits += cost;

      if (usedCredits > state.premiumMealsRemaining) {
        totalHalala += protein.extraFeeHalala;
      }
    }
    return totalHalala / 100.0;
  }

  int _premiumCreditsUsed(MealPlannerLoaded state) {
    var used = 0;
    final slots = state.selectedSlotsPerDay[state.selectedDayIndex] ?? const [];
    for (final slot in slots) {
      final proteinId = slot.proteinId;
      if (proteinId == null) continue;
      final protein = _findProteinById(state.menu, proteinId);
      if (protein != null && protein.isPremium) {
        used += protein.premiumCreditCost == 0 ? 1 : protein.premiumCreditCost;
      }
    }
    return used;
  }

  MealPlannerSlotSelection? _slotForIndex(
    MealPlannerLoaded state,
    int slotIndex,
  ) {
    final slots = state.selectedSlotsPerDay[state.selectedDayIndex] ?? [];
    if (slotIndex < 0 || slotIndex >= slots.length) return null;
    return slots[slotIndex];
  }

  List<BuilderCarbModel> _sortedCarbs(MealPlannerMenuModel menu) {
    final carbs = List<BuilderCarbModel>.from(menu.builderCatalog.carbs);
    carbs.sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
    return carbs;
  }

  BuilderProteinModel? _findProteinById(MealPlannerMenuModel menu, String id) {
    for (final protein in menu.builderCatalog.proteins) {
      if (protein.id == id) return protein;
    }
    return null;
  }

  BuilderCarbModel? _findCarbById(MealPlannerMenuModel menu, String id) {
    for (final carb in menu.builderCatalog.carbs) {
      if (carb.id == id) return carb;
    }
    return null;
  }

  Future<void> _openProteinPickerSheet({
    required BuildContext context,
    required MealPlannerLoaded state,
    required int slotIndex,
    required String? selectedProteinId,
  }) {
    final bloc = context.read<MealPlannerBloc>();

    var usedCredits = 0;
    final slots = state.selectedSlotsPerDay[state.selectedDayIndex] ?? const [];
    for (var index = 0; index < slots.length; index++) {
      if (index == slotIndex) continue;
      final proteinId = slots[index].proteinId;
      if (proteinId == null) continue;
      final protein = _findProteinById(state.menu, proteinId);
      if (protein == null || !protein.isPremium) continue;
      usedCredits +=
          protein.premiumCreditCost == 0 ? 1 : protein.premiumCreditCost;
    }
    final availableCredits = state.premiumMealsRemaining - usedCredits;

    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: ColorManager.transparent,
      builder:
          (sheetContext) => BlocProvider.value(
            value: bloc,
            child: ProteinPickerSheet(
              state: state,
              slotIndex: slotIndex,
              selectedProteinId: selectedProteinId,
              availablePremiumCredits:
                  availableCredits < 0 ? 0 : availableCredits,
            ),
          ),
    );
  }
}
