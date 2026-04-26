import 'package:basic_diet/presentation/plans/timeline/meal_planner/bloc/meal_planner_bloc.dart';
import 'package:basic_diet/presentation/plans/timeline/meal_planner/bloc/meal_planner_event.dart';
import 'package:basic_diet/presentation/plans/timeline/meal_planner/bloc/meal_planner_state.dart';
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

class MealPlannerBottomAction extends StatelessWidget {
  final MealPlannerLoaded state;

  const MealPlannerBottomAction({super.key, required this.state});

  @override
  Widget build(BuildContext context) {
    final canSave =
        state.isDirty &&
        _hasCompletedSelectedDay() &&
        !state.hasAnyPendingPayment &&
        state.isSelectedDayEditable;
    final hasPendingPayments = state.hasAnyPendingPayment;
    final paymentAmount = state.totalPendingPaymentAmountHalala / 100.0;

    return Container(
      padding: EdgeInsets.all(AppPadding.p16.w),
      decoration: BoxDecoration(
        color: ColorManager.backgroundSurface,
        boxShadow: [
          BoxShadow(
            color: ColorManager.textPrimary.withValues(alpha: 0.05),
            blurRadius: 12,
            offset: const Offset(0, -6),
          ),
        ],
      ),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (hasPendingPayments) ...[
              _ActionButton(
                label:
                    '${Strings.addonPayButton.tr()} ${_moneyLabel(paymentAmount)}',
                backgroundColor: ColorManager.brandAccent,
                foregroundColor: ColorManager.textInverse,
                isLoading:
                    state.isSaving &&
                    (state.activePaymentKind == 'premium' ||
                        state.activePaymentKind == 'addons'),
                onPressed:
                    () => context.read<MealPlannerBloc>().add(
                      state.hasPendingPremiumPayment
                          ? const InitiatePremiumPaymentEvent()
                          : const InitiateAddonPaymentEvent(),
                    ),
              ),
              Gap(AppSize.s10.h),
            ],
            _ActionButton(
              label:
                  !state.isSelectedDayEditable
                      ? Strings.dayLockedAddonsMessage.tr()
                      : canSave
                      ? Strings.saveChanges.tr()
                      : Strings.noChangesToSave.tr(),
              backgroundColor:
                  canSave
                      ? ColorManager.brandPrimary
                      : ColorManager.stateDisabledSurface,
              foregroundColor:
                  canSave
                      ? ColorManager.textInverse
                      : ColorManager.stateDisabled,
              isLoading:
                  state.isSaving &&
                  state.activePaymentKind != 'premium' &&
                  state.activePaymentKind != 'addons',
              onPressed:
                  canSave
                      ? () => context.read<MealPlannerBloc>().add(
                        const SaveMealPlannerChangesEvent(),
                      )
                      : null,
            ),
          ],
        ),
      ),
    );
  }

  bool _hasCompletedSelectedDay() {
    final required = state.selectedTimelineDay.requiredMeals;
    final slots = state.selectedSlotsPerDay[state.selectedDayIndex] ?? [];
    final completeCount =
        slots.where((slot) {
          if (slot.selectionType == 'sandwich') {
            return slot.sandwichId != null && slot.sandwichId!.isNotEmpty;
          }
          if (slot.selectionType == 'custom_premium_salad') {
            return slot.proteinId != null &&
                slot.carbId != null &&
                slot.customSalad != null &&
                slot.customSalad!.sauce.isNotEmpty;
          }
          return slot.proteinId != null && slot.carbId != null;
        }).length;
    return completeCount >= required;
  }

  String _moneyLabel(double amount) {
    return "${amount.toStringAsFixed(2)} ${Strings.sar.tr()}";
  }
}

class _ActionButton extends StatelessWidget {
  final String label;
  final Color backgroundColor;
  final Color foregroundColor;
  final bool isLoading;
  final VoidCallback? onPressed;

  const _ActionButton({
    required this.label,
    required this.backgroundColor,
    this.foregroundColor = ColorManager.textInverse,
    this.isLoading = false,
    this.onPressed,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      height: 56.h,
      child: ElevatedButton(
        onPressed: isLoading ? null : onPressed,
        style: ElevatedButton.styleFrom(
          backgroundColor: backgroundColor,
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppSize.s16.r),
          ),
        ),
        child:
            isLoading
                ? const CircularProgressIndicator(
                  color: ColorManager.textInverse,
                )
                : Text(
                  label,
                  textAlign: TextAlign.center,
                  style: getBoldTextStyle(
                    color: foregroundColor,
                    fontSize: FontSizeManager.s15.sp,
                  ),
                ),
      ),
    );
  }
}
