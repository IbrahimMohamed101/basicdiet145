import 'package:basic_diet/domain/model/add_ons_model.dart';
import 'package:basic_diet/presentation/plans/timeline/meal_planner/bloc/meal_planner_bloc.dart';
import 'package:basic_diet/presentation/plans/timeline/meal_planner/bloc/meal_planner_state.dart';
import 'package:basic_diet/presentation/plans/timeline/meal_planner/widgets/addon_selection_bottom_sheet.dart';
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

class DailyAddonSelectionCard extends StatelessWidget {
  final MealPlannerLoaded state;
  final bool isReadOnly;

  const DailyAddonSelectionCard({
    super.key,
    required this.state,
    required this.isReadOnly,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.all(AppPadding.p16.w),
      decoration: BoxDecoration(
        color: ColorManager.backgroundSurface,
        border: Border.all(color: ColorManager.borderDefault),
        borderRadius: BorderRadius.circular(AppSize.s16.r),
        boxShadow: [
          BoxShadow(
            color: ColorManager.textPrimary.withValues(alpha: 0.04),
            blurRadius: 18,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _CardHeader(isReadOnly: isReadOnly),
          Gap(AppSize.s16.h),
          if (state.plannerAddOnsCatalog.isEmpty)
            _DisabledSelectorField()
          else
            _AddonSelectorField(state: state, isReadOnly: isReadOnly),
          if (state.selectedAddOnModels.isNotEmpty) ...[
            Gap(AppSize.s12.h),
            _SelectedAddonsList(state: state),
          ],
          _PendingAddonBanner(state: state),
        ],
      ),
    );
  }
}

class _CardHeader extends StatelessWidget {
  final bool isReadOnly;
  const _CardHeader({required this.isReadOnly});

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          padding: EdgeInsets.all(AppPadding.p10.w),
          decoration: BoxDecoration(
            color: ColorManager.brandPrimaryTint,
            borderRadius: BorderRadius.circular(AppSize.s12.r),
          ),
          child: Icon(
            Icons.local_cafe_outlined,
            color: ColorManager.brandPrimary,
            size: AppSize.s18.sp,
          ),
        ),
        Gap(AppSize.s12.w),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                Strings.dayAddonsTitle.tr(),
                style: getBoldTextStyle(
                  color: ColorManager.textPrimary,
                  fontSize: FontSizeManager.s15.sp,
                ),
              ),
              Gap(AppSize.s4.h),
              Text(
                isReadOnly
                    ? Strings.dayLockedAddonsMessage.tr()
                    : Strings.dayAddonsSubtitle.tr(),
                style: getRegularTextStyle(
                  color: ColorManager.textSecondary,
                  fontSize: FontSizeManager.s12.sp,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _AddonSelectorField extends StatelessWidget {
  final MealPlannerLoaded state;
  final bool isReadOnly;

  const _AddonSelectorField({required this.state, required this.isReadOnly});

  @override
  Widget build(BuildContext context) {
    final hasSelection = state.selectedAddOnModels.isNotEmpty;

    return Opacity(
      opacity: isReadOnly ? 0.5 : 1.0,
      child: InkWell(
        borderRadius: BorderRadius.circular(AppSize.s14.r),
        onTap: isReadOnly ? null : () => _openCategorySheet(context),
        child: Ink(
          width: double.infinity,
          padding: EdgeInsets.symmetric(
            horizontal: AppPadding.p16.w,
            vertical: AppPadding.p14.h,
          ),
          decoration: BoxDecoration(
            color:
                hasSelection
                    ? ColorManager.brandPrimaryTint
                    : ColorManager.backgroundSubtle.withValues(alpha: 0.8),
            borderRadius: BorderRadius.circular(AppSize.s14.r),
            border: Border.all(
              color:
                  hasSelection
                      ? ColorManager.brandPrimary.withValues(alpha: 0.22)
                      : ColorManager.transparent,
            ),
          ),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  hasSelection
                      ? Strings.addonSelectedCount.tr(
                        namedArgs: {
                          'count': state.selectedAddOnModels.length.toString(),
                        },
                      )
                      : Strings.addonChoosePrompt.tr(),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.end,
                  style: getBoldTextStyle(
                    color:
                        hasSelection
                            ? ColorManager.textPrimary
                            : ColorManager.textSecondary,
                    fontSize: FontSizeManager.s14.sp,
                  ),
                ),
              ),
              Gap(AppSize.s10.w),
              Icon(
                Icons.keyboard_arrow_down_rounded,
                color: ColorManager.iconSecondary,
                size: 24.w,
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _openCategorySheet(BuildContext context) {
    final bloc = context.read<MealPlannerBloc>();
    final selectedByCategory = {
      for (final entry in state.groupedAddons.entries)
        entry.key: state.selectedAddonForCategory(entry.key)?.id,
    };

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: ColorManager.transparent,
      builder:
          (_) => AddonSelectionBottomSheet(
            bloc: bloc,
            groupedItems: state.groupedAddons,
            selectedAddonIdsByCategory: selectedByCategory,
            emptyLabel: Strings.addonNoItemsAvailable.tr(),
            badgeLabelBuilder:
                (addon) => _badgeLabelFor(addon.id, addon.priceHalala),
          ),
    );
  }

  String? _badgeLabelFor(String addonId, int priceHalala) {
    final status = state.addonSelectionStatusFor(addonId);
    if (status == 'subscription' || status == 'included') {
      return Strings.addonStatusIncluded.tr();
    }
    if (status == 'paid') {
      return Strings.addonStatusPaid.tr();
    }
    if (status == 'pending_payment') {
      return '${Strings.addonStatusPendingPayment.tr()} (${_moneyLabel(priceHalala, state.paymentCurrency)})';
    }
    return null;
  }
}

class _DisabledSelectorField extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Opacity(
      opacity: 0.5,
      child: Container(
        width: double.infinity,
        padding: EdgeInsets.symmetric(
          horizontal: AppPadding.p16.w,
          vertical: AppPadding.p14.h,
        ),
        decoration: BoxDecoration(
          color: ColorManager.backgroundSubtle.withValues(alpha: 0.8),
          borderRadius: BorderRadius.circular(AppSize.s14.r),
        ),
        child: Row(
          children: [
            Expanded(
              child: Text(
                Strings.addonNoItemsAvailable.tr(),
                textAlign: TextAlign.end,
                style: getBoldTextStyle(
                  color: ColorManager.textSecondary,
                  fontSize: FontSizeManager.s14.sp,
                ),
              ),
            ),
            Gap(AppSize.s10.w),
            Icon(
              Icons.keyboard_arrow_down_rounded,
              color: ColorManager.iconSecondary,
              size: 24.w,
            ),
          ],
        ),
      ),
    );
  }
}

class _SelectedAddonsList extends StatelessWidget {
  final MealPlannerLoaded state;

  const _SelectedAddonsList({required this.state});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        for (final addon in state.selectedAddOnModels) ...[
          _SelectedAddonRow(state: state, addon: addon),
          Gap(AppSize.s8.h),
        ],
      ],
    );
  }
}

class _SelectedAddonRow extends StatelessWidget {
  final MealPlannerLoaded state;
  final AddOnModel addon;

  const _SelectedAddonRow({required this.state, required this.addon});

  @override
  Widget build(BuildContext context) {
    final status = state.addonSelectionStatusFor(addon.id);
    final label = addon.ui.title.isNotEmpty ? addon.ui.title : addon.name;
    final badgeLabel =
        status == 'subscription' || status == 'included'
            ? Strings.addonStatusIncluded.tr()
            : status == 'paid'
            ? Strings.addonStatusPaid.tr()
            : '${Strings.addonStatusPendingPayment.tr()} ${_moneyLabel(addon.priceHalala, state.paymentCurrency)}';

    return Row(
      children: [
        Flexible(
          child: Container(
            padding: EdgeInsets.symmetric(
              horizontal: AppPadding.p10.w,
              vertical: AppPadding.p6.h,
            ),
            decoration: BoxDecoration(
              color:
                  status == 'subscription' || status == 'included'
                      ? ColorManager.stateSuccessSurface
                      : ColorManager.stateWarningSurface,
              borderRadius: BorderRadius.circular(AppSize.s20.r),
              border: Border.all(
                color:
                    status == 'subscription' || status == 'included'
                        ? ColorManager.brandPrimary
                        : ColorManager.stateWarningBorder,
              ),
            ),
            child: Text(
              badgeLabel,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: getBoldTextStyle(
                color:
                    status == 'subscription' || status == 'included'
                        ? ColorManager.stateSuccessEmphasis
                        : ColorManager.stateWarningEmphasis,
                fontSize: FontSizeManager.s10.sp,
              ),
            ),
          ),
        ),
        Gap(AppSize.s10.w),
        Expanded(
          child: Text(
            label,
            textAlign: TextAlign.end,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: getRegularTextStyle(
              color: ColorManager.textPrimary,
              fontSize: FontSizeManager.s12.sp,
            ),
          ),
        ),
      ],
    );
  }
}

class _PendingAddonBanner extends StatelessWidget {
  final MealPlannerLoaded state;
  const _PendingAddonBanner({required this.state});

  @override
  Widget build(BuildContext context) {
    final pendingCount = state.addonPendingPaymentCount;
    final amountHalala = state.addonPendingPaymentAmountHalala;

    if (pendingCount <= 0 && amountHalala <= 0) return const SizedBox.shrink();

    return Column(
      children: [
        Gap(AppSize.s12.h),
        Container(
          width: double.infinity,
          padding: EdgeInsets.symmetric(
            horizontal: AppPadding.p14.w,
            vertical: AppPadding.p10.h,
          ),
          decoration: BoxDecoration(
            color: ColorManager.stateWarningSurface,
            borderRadius: BorderRadius.circular(AppSize.s14.r),
            border: Border.all(color: ColorManager.stateWarningBorder),
          ),
          child: Row(
            children: [
              Icon(
                Icons.info_outline_rounded,
                color: ColorManager.stateWarningEmphasis,
                size: 16.sp,
              ),
              Gap(8.w),
              Expanded(
                child: Text(
                  Strings.addonPendingBanner.tr(
                    namedArgs: {
                      'amount': _moneyLabel(
                        amountHalala,
                        state.paymentCurrency,
                      ),
                    },
                  ),
                  style: getRegularTextStyle(
                    color: ColorManager.stateWarningEmphasis,
                    fontSize: FontSizeManager.s12.sp,
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

String _moneyLabel(int amountHalala, String currency) {
  final value = (amountHalala / 100).toStringAsFixed(2);
  return '${currency.isNotEmpty ? currency : 'SAR'} $value';
}
