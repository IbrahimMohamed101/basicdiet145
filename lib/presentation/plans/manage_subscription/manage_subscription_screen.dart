import 'package:flutter/material.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:basic_diet/presentation/resources/assets_manager.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:gap/gap.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:basic_diet/app/dependency_injection.dart';
import 'package:basic_diet/presentation/plans/manage_subscription/freeze/freeze_subscription_screen.dart';
import 'package:basic_diet/presentation/plans/manage_subscription/skip/skip_days_screen.dart';
import 'package:basic_diet/presentation/plans/manage_subscription/delivery_settings/delivery_settings_screen.dart';
import 'package:basic_diet/presentation/plans/manage_subscription/cancel/cancel_subscription_bloc.dart';
import 'package:basic_diet/presentation/plans/manage_subscription/cancel/cancel_subscription_event.dart';
import 'package:basic_diet/presentation/plans/manage_subscription/cancel/cancel_subscription_state.dart';
import 'package:basic_diet/presentation/widgets/confirmation_dialog.dart';

import '../../../app/constants.dart';

class ManageSubscriptionScreen extends StatelessWidget {
  final String subscriptionId;
  final int selectedMealsPerDay;
  final String deliveryModeLabel;
  final String validityEndDate;
  final int skipDaysUsed;
  final int skipDaysLimit;
  final int remainingSkipDays;

  const ManageSubscriptionScreen({
    super.key,
    required this.subscriptionId,
    required this.selectedMealsPerDay,
    required this.deliveryModeLabel,
    required this.validityEndDate,
    required this.skipDaysUsed,
    required this.skipDaysLimit,
    required this.remainingSkipDays,
  });

  @override
  Widget build(BuildContext context) {
    String formattedDate = '';
    try {
      DateTime dt = DateTime.parse(validityEndDate);
      formattedDate = DateFormat(
        'MMMM d, yyyy',
        context.locale.toString(),
      ).format(dt);
    } catch (e) {
      formattedDate = validityEndDate;
    }

    return BlocProvider(
      create: (_) {
        initCancelSubscriptionModule();
        return instance<CancelSubscriptionBloc>();
      },
      child: BlocConsumer<CancelSubscriptionBloc, CancelSubscriptionState>(
        listener: (context, state) {
          if (state is CancelSubscriptionSuccess) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text(Strings.subscriptionCanceledSuccessfully.tr()),
                backgroundColor: ColorManager.stateSuccess,
              ),
            );
            Navigator.of(context).pop(true);
          } else if (state is CancelSubscriptionError) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text(state.message),
                backgroundColor: ColorManager.stateError,
              ),
            );
          }
        },
        builder: (context, state) => Scaffold(
          backgroundColor: ColorManager.backgroundApp,
          appBar: AppBar(
            backgroundColor: ColorManager.backgroundSurface,
            elevation: 0,
            centerTitle: true,
            leading: IconButton(
              icon: const Icon(
                Icons.arrow_back,
                color: ColorManager.textPrimary,
              ),
              onPressed: () => Navigator.of(context).pop(),
            ),
            title: Text(
              Strings.manageSubscription.tr(),
              style: getRegularTextStyle(
                color: ColorManager.textPrimary,
                fontSize: FontSizeManager.s18.sp,
              ),
            ),
            bottom: PreferredSize(
              preferredSize: const Size.fromHeight(1.0),
              child: Container(
                color: ColorManager.borderDefault,
                height: 1.0,
              ),
            ),
          ),
          body: SingleChildScrollView(
            padding: const EdgeInsets.all(AppPadding.p16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _buildPlanCard(formattedDate),
                Gap(AppSize.s24.h),
                Text(
                  Strings.subscriptionActions.tr(),
                  style: getRegularTextStyle(
                    color: ColorManager.textPrimary,
                    fontSize: FontSizeManager.s16.sp,
                  ),
                ),
                Gap(AppSize.s12.h),
                _buildActionItem(
                  icon: IconAssets.freeze,
                  title: Strings.freezeSubscription.tr(),
                  subtitle: Strings.freezeSubscriptionDesc.tr(),
                  onTap: () {
                    Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (context) => FreezeSubscriptionScreen(
                          subscriptionId: subscriptionId,
                          validityEndDate: validityEndDate,
                        ),
                      ),
                    );
                  },
                ),
                Gap(AppSize.s12.h),
                _buildActionItem(
                  icon: IconAssets.skip,
                  title: Strings.skipDays.tr(),
                  subtitle: Strings.skipDaysDesc.tr(),
                  onTap: () {
                    Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (context) => SkipDaysScreen(
                          subscriptionId: subscriptionId,
                          skipDaysUsed: skipDaysUsed,
                          skipDaysLimit: skipDaysLimit,
                          remainingSkipDays: remainingSkipDays,
                        ),
                      ),
                    );
                  },
                ),
                Gap(AppSize.s12.h),
                _buildActionItem(
                  icon: IconAssets.delivery,
                  title: Strings.deliverySettings.tr(),
                  subtitle: Strings.deliverySettingsDesc.tr(),
                  onTap: () {
                    Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (context) => const DeliverySettingsScreen(),
                      ),
                    );
                  },
                ),
                if (Constants.isDebug) ...[
                  Gap(AppSize.s24.h),
                  _buildDangerZone(context, state),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildPlanCard(String date) {
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: ColorManager.brandPrimaryTint,
        border: Border.all(
          color: ColorManager.brandPrimary.withValues(alpha: 0.2),
        ),
        borderRadius: BorderRadius.circular(AppSize.s16),
      ),
      padding: const EdgeInsets.all(AppPadding.p16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            Strings.premiumMonthlyPlan.tr(),
            style: getBoldTextStyle(
              color: ColorManager.textPrimary,
              fontSize: FontSizeManager.s18.sp,
            ),
          ),
          Gap(AppSize.s8.h),
          Text(
            '${Strings.activeUntil.tr()} $date',
            style: getRegularTextStyle(
              color: ColorManager.textSecondary,
              fontSize: FontSizeManager.s14.sp,
            ),
          ),
          Gap(AppSize.s16.h),
          Row(
            children: [
              Expanded(
                child: Container(
                  padding: const EdgeInsets.all(AppPadding.p12),
                  decoration: BoxDecoration(
                    color: ColorManager.backgroundSurface,
                    borderRadius: BorderRadius.circular(AppSize.s8),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        Strings.mealsPerDay.tr(),
                        style: getRegularTextStyle(
                          color: ColorManager.textSecondary,
                          fontSize: FontSizeManager.s14.sp,
                        ),
                      ),
                      Gap(AppSize.s4.h),
                      Text(
                        selectedMealsPerDay.toString(),
                        style: getRegularTextStyle(
                          color: ColorManager.textPrimary,
                          fontSize: FontSizeManager.s16.sp,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              Gap(AppSize.s12.w),
              Expanded(
                child: Container(
                  padding: const EdgeInsets.all(AppPadding.p12),
                  decoration: BoxDecoration(
                    color: ColorManager.backgroundSurface,
                    borderRadius: BorderRadius.circular(AppSize.s8),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        Strings.deliveryMode.tr(),
                        style: getRegularTextStyle(
                          color: ColorManager.textSecondary,
                          fontSize: FontSizeManager.s14.sp,
                        ),
                      ),
                      Gap(AppSize.s4.h),
                      Text(
                        deliveryModeLabel.isNotEmpty
                            ? deliveryModeLabel
                            : Strings.delivery.tr(),
                        style: getRegularTextStyle(
                          color: ColorManager.textPrimary,
                          fontSize: FontSizeManager.s16.sp,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildActionItem({
    required String icon,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppSize.s12),
      child: Container(
        padding: const EdgeInsets.all(AppPadding.p16),
        decoration: BoxDecoration(
          color: ColorManager.backgroundSurface,
          border: Border.all(color: ColorManager.borderDefault),
          borderRadius: BorderRadius.circular(AppSize.s12),
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(AppPadding.p12),
              decoration: BoxDecoration(
                color: ColorManager.brandPrimaryTint,
                shape: BoxShape.circle,
              ),
              child: SvgPicture.asset(
                icon,
                width: AppSize.s24,
                height: AppSize.s24,
              ),
            ),
            Gap(AppSize.s16.w),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: getRegularTextStyle(
                      color: ColorManager.textPrimary,
                      fontSize: FontSizeManager.s16.sp,
                    ),
                  ),
                  Gap(AppSize.s4.h),
                  Text(
                    subtitle,
                    style: getRegularTextStyle(
                      color: ColorManager.textSecondary,
                      fontSize: FontSizeManager.s14.sp,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDangerZone(BuildContext context, CancelSubscriptionState state) {
    final isLoading = state is CancelSubscriptionLoading;

    return Container(
      decoration: BoxDecoration(
        color: ColorManager.stateErrorSurface,
        border: Border.all(color: ColorManager.stateErrorBorder),
        borderRadius: BorderRadius.circular(AppSize.s16),
      ),
      padding: const EdgeInsets.all(AppPadding.p16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            Strings.dangerZone.tr(),
            style: getRegularTextStyle(
              color: ColorManager.stateErrorEmphasis,
              fontSize: FontSizeManager.s16.sp,
            ),
          ),
          Gap(AppSize.s8.h),
          Text(
            Strings.dangerZoneDesc.tr(),
            style: getRegularTextStyle(
              color: ColorManager.stateError,
              fontSize: FontSizeManager.s14.sp,
            ),
          ),
          Gap(AppSize.s16.h),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: isLoading ? null : () => _showCancelWarning(context),
              icon: isLoading
                  ? SizedBox(
                      width: AppSize.s20,
                      height: AppSize.s20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: ColorManager.stateError,
                      ),
                    )
                  : SvgPicture.asset(
                      IconAssets.cancel,
                      width: AppSize.s20,
                      height: AppSize.s20,
                      colorFilter: const ColorFilter.mode(
                        ColorManager.stateError,
                        BlendMode.srcIn,
                      ),
                    ),
              label: Text(
                Strings.cancelSubscription.tr(),
                style: getRegularTextStyle(
                  color: ColorManager.stateError,
                  fontSize: FontSizeManager.s16.sp,
                ),
              ),
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: AppPadding.p16),
                side: const BorderSide(color: ColorManager.stateError),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(AppSize.s12),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _showCancelWarning(BuildContext context) {
    showDialog<void>(
      context: context,
      builder: (_) => ConfirmationDialog(
        title: Strings.cancelSubscriptionWarningTitle.tr(),
        body: Strings.cancelSubscriptionWarningBody.tr(),
        confirmLabel: Strings.cancelSubscriptionConfirm.tr(),
        cancelLabel: Strings.cancel.tr(),
        onConfirm: () {
          context.read<CancelSubscriptionBloc>().add(
            SubmitCancelSubscriptionEvent(subscriptionId: subscriptionId),
          );
        },
      ),
    );
  }
}
