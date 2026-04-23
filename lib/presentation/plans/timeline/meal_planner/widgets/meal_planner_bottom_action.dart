import 'package:basic_diet/domain/model/meal_planner_menu_model.dart';
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

  double _premiumPaymentAmount() {
    var totalHalala = 0;
    var usedCredits = 0;
    final slotsForSelectedDay =
        state.selectedSlotsPerDay[state.selectedDayIndex] ?? const [];

    for (final slot in slotsForSelectedDay) {
      final proteinId = slot.proteinId;
      if (proteinId == null) continue;
      final protein = _findProteinById(proteinId);
      if (protein == null || !protein.isPremium) continue;

      final cost = protein.premiumCreditCost == 0 ? 1 : protein.premiumCreditCost;
      usedCredits += cost;

      if (usedCredits > state.premiumMealsRemaining) {
        totalHalala += protein.extraFeeHalala;
      }
    }
    return totalHalala / 100.0;
  }

  bool _hasCompletedDay() {
    for (int i = 0; i < state.timelineDays.length; i++) {
      final required = state.timelineDays[i].requiredMeals;
      final slots = state.selectedSlotsPerDay[i] ?? [];
      final completeSlotsCount =
          slots.where((s) => s.proteinId != null && s.carbId != null).length;
      if (completeSlotsCount >= required) return true;
    }
    return false;
  }

  BuilderProteinModel? _findProteinById(String id) {
    for (final protein in state.menu.builderCatalog.proteins) {
      if (protein.id == id) return protein;
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final bool canSave = state.isDirty && _hasCompletedDay();
    final bool hasPendingPayment = state.premiumMealsPendingPayment > 0;

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
            if (hasPendingPayment) ...[
              _PayNowButton(
                isSaving: state.isSaving,
                paymentAmount: _premiumPaymentAmount(),
              ),
              Gap(AppSize.s12.h),
            ],
            _SaveButton(
              canSave: canSave,
              hasPendingPayment: hasPendingPayment,
              isSaving: state.isSaving,
            ),
          ],
        ),
      ),
    );
  }
}

class _PayNowButton extends StatelessWidget {
  final bool isSaving;
  final double paymentAmount;

  const _PayNowButton({required this.isSaving, required this.paymentAmount});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      height: 56.h,
      child: ElevatedButton(
        onPressed: isSaving
            ? null
            : () => context
                .read<MealPlannerBloc>()
                .add(const InitiatePremiumPaymentEvent()),
        style: ElevatedButton.styleFrom(
          backgroundColor: ColorManager.brandAccent,
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppSize.s16.r),
          ),
        ),
        child: isSaving
            ? const CircularProgressIndicator(color: ColorManager.textInverse)
            : Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.payment, color: ColorManager.textInverse, size: AppSize.s20.w),
                  Gap(AppSize.s8.w),
                  Text(
                    "${Strings.payNow.tr()} ${paymentAmount.toStringAsFixed(2)} ${Strings.sar.tr()}",
                    style: getBoldTextStyle(
                      color: ColorManager.textInverse,
                      fontSize: FontSizeManager.s16.sp,
                    ),
                  ),
                ],
              ),
      ),
    );
  }
}

class _SaveButton extends StatelessWidget {
  final bool canSave;
  final bool hasPendingPayment;
  final bool isSaving;

  const _SaveButton({
    required this.canSave,
    required this.hasPendingPayment,
    required this.isSaving,
  });

  @override
  Widget build(BuildContext context) {
    final isEnabled = canSave && !hasPendingPayment;

    return SizedBox(
      width: double.infinity,
      height: 56.h,
      child: ElevatedButton(
        onPressed: isEnabled
            ? () => context
                .read<MealPlannerBloc>()
                .add(const SaveMealPlannerChangesEvent())
            : null,
        style: ElevatedButton.styleFrom(
          backgroundColor:
              isEnabled ? ColorManager.brandPrimary : ColorManager.stateDisabledSurface,
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppSize.s16.r),
          ),
        ),
        child: isSaving && !hasPendingPayment
            ? const CircularProgressIndicator(color: ColorManager.textInverse)
            : Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    Icons.check,
                    color: isEnabled ? ColorManager.textInverse : ColorManager.stateDisabled,
                    size: AppSize.s20.w,
                  ),
                  Gap(AppSize.s8.w),
                  Text(
                    hasPendingPayment
                        ? Strings.payFirstToSave.tr()
                        : canSave
                            ? Strings.saveChanges.tr()
                            : Strings.noChangesToSave.tr(),
                    style: getBoldTextStyle(
                      color: isEnabled ? ColorManager.textInverse : ColorManager.stateDisabled,
                      fontSize: FontSizeManager.s16.sp,
                    ),
                  ),
                ],
              ),
      ),
    );
  }
}
