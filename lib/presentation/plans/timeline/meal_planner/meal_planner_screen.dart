import 'package:basic_diet/app/dependency_injection.dart';
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
import 'package:basic_diet/presentation/plans/timeline/meal_planner/widgets/meal_slot_card.dart';
import 'package:basic_diet/presentation/plans/timeline/meal_planner/widgets/protein_picker_sheet.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';

class MealPlannerScreen extends StatelessWidget {
  final List<TimelineDayModel> timelineDays;
  final int initialDayIndex;
  final int premiumMealsRemaining;
  final String subscriptionId;
  final bool readOnly;

  const MealPlannerScreen({
    super.key,
    required this.timelineDays,
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
                listenWhen: (prev, curr) {
                  if (prev is! MealPlannerLoaded ||
                      curr is! MealPlannerLoaded) {
                    return false;
                  }
                  if (!prev.saveSuccess && curr.saveSuccess) {
                    return true;
                  }
                  if (prev.paymentUrl == null && curr.paymentUrl != null) {
                    return true;
                  }
                  if (curr.paymentError != null &&
                      prev.paymentError != curr.paymentError) {
                    return true;
                  }
                  return false;
                },
                listener: (context, state) {
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
                  } else if (state.paymentUrl != null &&
                      state.paymentId != null) {
                    _openPaymentWebView(
                      context,
                      state.paymentUrl!,
                      state.paymentId!,
                    );
                  } else if (state.paymentError != null) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: Text(state.paymentError!),
                        backgroundColor: ColorManager.stateError,
                      ),
                    );
                  }
                },
                child: const MealPlannerView(),
              ),
    );
  }

  Future<void> _openPaymentWebView(
    BuildContext context,
    String paymentUrl,
    String paymentId,
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

    final result = await Navigator.push<PaymentWebViewResult>(
      context,
      MaterialPageRoute(
        builder:
            (_) => PaymentWebViewScreen(
              paymentUrl: paymentUrl,
              draftId: paymentId,
              successUrl: _premiumPaymentSuccessUrl,
              backUrl: _premiumPaymentCancelUrl,
              onSuccess: () => Navigator.of(context).pop(),
            ),
      ),
    );

    if (!context.mounted) return;

    if (result == PaymentWebViewResult.cancelled) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(Strings.paymentCancelled.tr())));
    } else {
      context.read<MealPlannerBloc>().add(VerifyPremiumPaymentEvent(paymentId));
    }
  }
}

const String _premiumPaymentSuccessUrl =
    'https://app.example.com/payments/premium/success';
const String _premiumPaymentCancelUrl =
    'https://app.example.com/payments/premium/cancel';

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

class MealPlannerView extends StatelessWidget {
  final bool readOnly;

  const MealPlannerView({super.key, this.readOnly = false});

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<MealPlannerBloc, MealPlannerState>(
      builder: (context, state) {
        final bool isViewOnly =
            state is MealPlannerLoaded &&
            (readOnly ||
                state.timelineDays[state.selectedDayIndex].status
                        .toLowerCase() ==
                    'planned');

        return Scaffold(
          backgroundColor: ColorManager.backgroundSurface,
          bottomNavigationBar:
              state is MealPlannerLoaded && !isViewOnly
                  ? MealPlannerBottomAction(state: state)
                  : null,
          body: SafeArea(child: _buildBody(context, state)),
        );
      },
    );
  }

  Widget _buildBody(BuildContext context, MealPlannerState state) {
    if (state is MealPlannerLoading) {
      return Center(
        child: CircularProgressIndicator(color: ColorManager.brandPrimary),
      );
    }
    if (state is MealPlannerError) {
      return Center(child: Text(state.message));
    }
    if (state is! MealPlannerLoaded) {
      return const SizedBox.shrink();
    }

    final selectedDayStatus =
        state.timelineDays[state.selectedDayIndex].status.toLowerCase();
    final isSelectedDayReadOnly = readOnly || selectedDayStatus == 'planned';

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
                  ],
                ),
              ),
            ),
            SliverPadding(
              padding: EdgeInsets.only(
                left: AppPadding.p16.w,
                right: AppPadding.p16.w,
                bottom: 24.h,
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

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  int _selectedMealsCount(MealPlannerLoaded state) {
    final slots = state.selectedSlotsPerDay[state.selectedDayIndex] ?? [];
    return slots.where((s) => s.proteinId != null && s.carbId != null).length;
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
    for (final entry in state.selectedSlotsPerDay.entries) {
      for (final slot in entry.value) {
        final proteinId = slot.proteinId;
        if (proteinId == null) continue;
        final protein = _findProteinById(state.menu, proteinId);
        if (protein != null && protein.isPremium) {
          used +=
              protein.premiumCreditCost == 0 ? 1 : protein.premiumCreditCost;
        }
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
    for (final entry in state.selectedSlotsPerDay.entries) {
      for (var i = 0; i < entry.value.length; i++) {
        if (entry.key == state.selectedDayIndex && i == slotIndex) continue;
        final proteinId = entry.value[i].proteinId;
        if (proteinId == null) continue;
        final protein = _findProteinById(state.menu, proteinId);
        if (protein == null || !protein.isPremium) continue;
        usedCredits +=
            protein.premiumCreditCost == 0 ? 1 : protein.premiumCreditCost;
      }
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
