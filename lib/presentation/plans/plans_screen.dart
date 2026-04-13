import 'package:easy_localization/easy_localization.dart';
import 'package:basic_diet/presentation/main/home/subscription/subscription_screen.dart';
import 'package:basic_diet/presentation/plans/timeline/time_line_screen.dart';
import 'package:flutter/material.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:basic_diet/app/dependency_injection.dart';
import 'package:basic_diet/presentation/plans/bloc/plans_bloc.dart';
import 'package:basic_diet/presentation/plans/bloc/plans_event.dart';
import 'package:basic_diet/presentation/plans/bloc/plans_state.dart';
import 'package:basic_diet/domain/model/current_subscription_overview_model.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';
import 'package:basic_diet/presentation/plans/manage_subscription/manage_subscription_screen.dart';
import 'package:basic_diet/presentation/resources/assets_manager.dart';
import 'package:go_router/go_router.dart';

class PlansScreen extends StatelessWidget {
  const PlansScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (context) {
        initPlansModule();
        return instance<PlansBloc>()
          ..add(FetchCurrentSubscriptionOverviewEvent());
      },
      child: Scaffold(
        backgroundColor: Colors.white,
        body: SafeArea(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(AppPadding.p16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SizedBox(height: AppSize.s8),
                _buildHeader(),
                const SizedBox(height: AppSize.s24),
                BlocBuilder<PlansBloc, PlansState>(
                  builder: (context, state) {
                    if (state is PlansLoading || state is PlansInitial) {
                      return const Center(
                        child: CircularProgressIndicator(
                          color: ColorManager.greenPrimary,
                        ),
                      );
                    } else if (state is PlansError) {
                      return Center(child: Text(state.message));
                    } else if (state is CurrentSubscriptionOverviewLoaded) {
                      final data = state.currentSubscriptionOverviewModel.data;

                      if (data == null) {
                        return _buildNoSubscriptionState(context);
                      }

                      return Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          _buildSubscriptionPlanCard(context, data),
                          Gap(AppSize.s16.h),
                          _buildActionButtons(context, data),
                          if (data.pickupPreparation != null) ...[
                            Gap(AppSize.s16.h),
                            if (data.pickupPreparation!.flowStatus ==
                                'disabled')
                              _buildOrderStatusCard(data)
                            else if (data.pickupPreparation!.flowStatus ==
                                'available')
                              _buildPreparationCard(data),
                          ],
                          // _buildSubscriptionPeriodCard(data),
                          Gap(AppSize.s24.h),
                        ],
                      );
                    }
                    return const SizedBox.shrink();
                  },
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              Strings.mySubscription.tr(),
              style: getBoldTextStyle(
                color: ColorManager.black101828,
                fontSize: FontSizeManager.s22.sp,
              ),
            ),
            Gap(AppSize.s4.h),
            Text(
              Strings.welcomeBack.tr(),
              style: getRegularTextStyle(
                color: ColorManager.grey6A7282,
                fontSize: FontSizeManager.s14.sp,
              ),
            ),
          ],
        ),
        Container(
          padding: const EdgeInsetsDirectional.all(AppPadding.p8),
          decoration: BoxDecoration(
            color: ColorManager.greenPrimary.withValues(alpha: 0.1),
            shape: BoxShape.circle,
          ),
          child: Text('👋', style: TextStyle(fontSize: FontSizeManager.s20.sp)),
        ),
      ],
    );
  }

  Widget _buildSubscriptionPlanCard(
    BuildContext context,
    CurrentSubscriptionOverviewDataModel data,
  ) {
    double progressValue = data.totalMeals > 0
        ? (data.remainingMeals / data.totalMeals)
        : 0.0;

    return Container(
      decoration: BoxDecoration(
        color: ColorManager.whiteColor,
        borderRadius: BorderRadius.circular(AppSize.s16),
        border: Border.all(color: ColorManager.formFieldsBorderColor),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.02),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      padding: const EdgeInsetsDirectional.all(AppPadding.p16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                Strings.subscriptionPlanText.tr(),
                style: getBoldTextStyle(
                  color: ColorManager.black101828,
                  fontSize: FontSizeManager.s18.sp,
                ),
              ),
              InkWell(
                onTap: () {
                  Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (context) => ManageSubscriptionScreen(
                        subscriptionId: data.id,
                        selectedMealsPerDay: data.selectedMealsPerDay,
                        deliveryModeLabel: data.deliveryModeLabel,
                        validityEndDate: data.validityEndDate,
                        skipDaysUsed: data.skipDaysUsed,
                        skipDaysLimit: data.skipDaysLimit,
                        remainingSkipDays: data.remainingSkipDays,
                      ),
                    ),
                  );
                },
                child: const Icon(
                  Icons.settings_outlined,
                  color: ColorManager.grey6A7282,
                  size: AppSize.s20,
                ),
              ),
            ],
          ),
          Gap(AppSize.s16.h),
          Container(
            padding: const EdgeInsetsDirectional.symmetric(
              horizontal: AppPadding.p12,
              vertical: AppPadding.p6,
            ),
            decoration: BoxDecoration(
              color: ColorManager.greenPrimary.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(AppSize.s20.r),
            ),
            child: Text(
              data.statusLabel.isNotEmpty ? data.statusLabel : Strings.active.tr(),
              style: getBoldTextStyle(
                color: ColorManager.greenPrimary,
                fontSize: FontSizeManager.s12.sp,
              ),
            ),
          ),
          Gap(AppSize.s24.h),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                Strings.regularMealsRemaining.tr(),
                style: getRegularTextStyle(
                  color: ColorManager.grey6A7282,
                  fontSize: FontSizeManager.s14.sp,
                ),
              ),
              Text(
                "${data.remainingMeals} / ${data.totalMeals}",
                style: getBoldTextStyle(
                  color: ColorManager.black101828,
                  fontSize: FontSizeManager.s16.sp,
                ),
              ),
            ],
          ),
          Gap(AppSize.s8.h),
          ClipRRect(
            borderRadius: BorderRadius.circular(AppSize.s4),
            child: LinearProgressIndicator(
              value: progressValue,
              backgroundColor: ColorManager.formFieldsBorderColor,
              valueColor: const AlwaysStoppedAnimation<Color>(
                ColorManager.greenPrimary,
              ),
              minHeight: AppSize.s8,
            ),
          ),
          Gap(AppSize.s24.h),
          Container(height: 1, color: ColorManager.formFieldsBorderColor),
          Gap(AppSize.s20.h),

          if (data.premiumSummary.isNotEmpty) ...[
            ...data.premiumSummary.map(
              (premium) => Column(
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(
                        padding: const EdgeInsetsDirectional.all(AppPadding.p8),
                        decoration: BoxDecoration(
                          color: ColorManager.orangePrimary.withValues(
                            alpha: 0.1,
                          ),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(
                          Icons.workspace_premium_outlined,
                          color: ColorManager.orangePrimary,
                          size: AppSize.s18,
                        ),
                      ),
                      Gap(AppSize.s12.w),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(
                                  Strings.premiumMealsText.tr(),
                                  style: getRegularTextStyle(
                                    color: ColorManager.grey6A7282,
                                    fontSize: FontSizeManager.s14.sp,
                                  ),
                                ),
                                Text(
                                  "${premium.remainingQtyTotal} ${Strings.available.tr()}",
                                  style: getBoldTextStyle(
                                    color: ColorManager.grey4A5565,
                                    fontSize: FontSizeManager.s14.sp,
                                  ),
                                ),
                              ],
                            ),
                            Gap(AppSize.s4.h),
                            Text(
                              "${Strings.purchased.tr()} ${premium.purchasedQtyTotal} • ${Strings.consumed.tr()} ${premium.consumedQtyTotal}",
                              style: getRegularTextStyle(
                                color: ColorManager.grey6A7282,
                                fontSize: FontSizeManager.s12.sp,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  Gap(AppSize.s24.h),
                ],
              ),
            ),
          ],

          if (data.addonSubscriptions.isNotEmpty) ...[
            Text(
              Strings.addOnsIncluded.tr(),
              style: getRegularTextStyle(
                color: ColorManager.grey6A7282,
                fontSize: FontSizeManager.s12.sp,
              ),
            ),
            Gap(AppSize.s8.h),
            Wrap(
              spacing: AppSize.s8,
              runSpacing: AppSize.s8,
              children: data.addonSubscriptions.map((addon) {
                return Container(
                  padding: const EdgeInsetsDirectional.symmetric(
                    horizontal: AppPadding.p12,
                    vertical: AppPadding.p8,
                  ),
                  decoration: BoxDecoration(
                    border: Border.all(
                      color: ColorManager.formFieldsBorderColor,
                    ),
                    borderRadius: BorderRadius.circular(AppSize.s20),
                  ),
                  child: Text(
                    "${addon.name} • 1/${Strings.day.tr()}",
                    style: getRegularTextStyle(
                      color: ColorManager.grey6A7282,
                      fontSize: FontSizeManager.s12,
                    ),
                  ),
                );
              }).toList(),
            ),
            Gap(AppSize.s20.h),
          ],

          Row(
            children: [
              const Icon(
                Icons.location_on_outlined,
                color: ColorManager.grey6A7282,
                size: AppSize.s18,
              ),
              const SizedBox(width: AppSize.s4),
              Text(
                data.deliveryModeLabel.isNotEmpty
                    ? data.deliveryModeLabel
                    : Strings.pickup.tr(),
                style: getRegularTextStyle(
                  color: ColorManager.grey6A7282,
                  fontSize: FontSizeManager.s14.sp,
                ),
              ),
              Gap(AppSize.s16.w),
              const Icon(
                Icons.access_time_outlined,
                color: ColorManager.grey6A7282,
                size: AppSize.s18,
              ),
              const SizedBox(width: AppSize.s4),
              Text(
                "${data.selectedMealsPerDay} ${Strings.mealsDay.tr()}",
                style: getRegularTextStyle(
                  color: ColorManager.grey6A7282,
                  fontSize: FontSizeManager.s14,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildActionButtons(
    BuildContext context,
    CurrentSubscriptionOverviewDataModel data,
  ) {
    return Row(
      children: [
        Expanded(
          child: ElevatedButton(
            onPressed: () async {
              await Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (context) => TimeLineScreen(subscriptionId: data.id),
                ),
              );
              if (context.mounted) {
                context.read<PlansBloc>().add(
                  FetchCurrentSubscriptionOverviewEvent(),
                );
              }
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: ColorManager.greenPrimary,
              padding: const EdgeInsets.symmetric(vertical: AppPadding.p16),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(AppSize.s12),
              ),
              elevation: 0,
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(
                  Icons.calendar_today_outlined,
                  color: Colors.white,
                  size: AppSize.s18,
                ),
                Gap(AppSize.s8.w),
                Text(
                  Strings.viewTimeline.tr(),
                  style: getRegularTextStyle(
                    color: Colors.white,
                    fontSize: FontSizeManager.s14.sp,
                  ),
                ),
              ],
            ),
          ),
        ),
        Gap(AppSize.s12.w),
        Expanded(
          child: OutlinedButton(
            onPressed: () {},
            style: OutlinedButton.styleFrom(
              padding: const EdgeInsetsDirectional.symmetric(
                vertical: AppPadding.p16,
              ),
              foregroundColor: ColorManager.black101828,
              side: const BorderSide(color: ColorManager.formFieldsBorderColor),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(AppSize.s12.r),
              ),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(
                  Icons.access_time,
                  color: ColorManager.black101828,
                  size: AppSize.s18,
                ),
                Gap(AppSize.s8.w),
                Text(
                  Strings.todaysMeals.tr(),
                  style: getRegularTextStyle(
                    color: ColorManager.black101828,
                    fontSize: FontSizeManager.s14.sp,
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildSubscriptionPeriodCard(
    CurrentSubscriptionOverviewDataModel data,
  ) {
    // Extracting just the date portion since it comes as an ISO string
    String startDateFormatted = data.startDate.split('T')[0];
    String endDateFormatted = data.endDate.split('T')[0];

    return Container(
      decoration: BoxDecoration(
        color: ColorManager.whiteColor,
        borderRadius: BorderRadius.circular(AppSize.s16.r),
        border: Border.all(color: ColorManager.formFieldsBorderColor),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.02),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      padding: const EdgeInsetsDirectional.all(AppPadding.p16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            Strings.subscriptionPeriodText.tr(),
            style: getRegularTextStyle(
              color: ColorManager.black101828,
              fontSize: FontSizeManager.s16.sp,
            ),
          ),
          Gap(AppSize.s16.h),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    Strings.startDate.tr(),
                    style: getRegularTextStyle(
                      color: ColorManager.grey6A7282,
                      fontSize: FontSizeManager.s12.sp,
                    ),
                  ),
                  Gap(AppSize.s4.h),
                  Text(
                    startDateFormatted,
                    style: getRegularTextStyle(
                      color: ColorManager.black101828,
                      fontSize: FontSizeManager.s14.sp,
                    ),
                  ),
                ],
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    Strings.endDate.tr(),
                    style: getRegularTextStyle(
                      color: ColorManager.grey6A7282,
                      fontSize: FontSizeManager.s12.sp,
                    ),
                  ),
                  Gap(AppSize.s4.h),
                  Text(
                    endDateFormatted,
                    style: getRegularTextStyle(
                      color: ColorManager.black101828,
                      fontSize: FontSizeManager.s14.sp,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildNoSubscriptionState(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: AppPadding.p24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Gap(AppSize.s60.h),
            Container(
              height: 220.h,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(AppSize.s24.r),
                boxShadow: [
                  BoxShadow(
                    color: ColorManager.greenPrimary.withValues(alpha: 0.1),
                    blurRadius: 40,
                    offset: const Offset(0, 10),
                  ),
                ],
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(AppSize.s24.r),
                child: Image.asset(
                  ImageAssets.noSubscription,
                  fit: BoxFit.contain,
                ),
              ),
            ),
            Gap(AppSize.s40.h),
            Text(
              Strings.noSubscriptionTitle.tr(),
              textAlign: TextAlign.center,
              style: getBoldTextStyle(
                color: ColorManager.black101828,
                fontSize: FontSizeManager.s22.sp,
              ),
            ),
            Gap(AppSize.s12.h),
            Text(
              Strings.noSubscriptionSubtitle.tr(),
              textAlign: TextAlign.center,
              style: getRegularTextStyle(
                color: ColorManager.grey6A7282,
                fontSize: FontSizeManager.s15.sp,
              ),
            ),
            Gap(AppSize.s40.h),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () {
                  // Navigate to plans selection using GoRouter
                  context.pushReplacement(SubscriptionScreen.subscriptionRoute);
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: ColorManager.greenPrimary,
                  padding: const EdgeInsets.symmetric(vertical: AppPadding.p18),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(AppSize.s16.r),
                  ),
                  elevation: 4,
                  shadowColor: ColorManager.greenPrimary.withValues(alpha: 0.3),
                ),
                child: Text(
                  Strings.exploreOurPlans.tr(),
                  style: getBoldTextStyle(
                    color: Colors.white,
                    fontSize: FontSizeManager.s16.sp,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildOrderStatusCard(CurrentSubscriptionOverviewDataModel data) {
    return Container(
      width: double.infinity,
      height: 194.h,
      padding: EdgeInsets.all(24.w),
      decoration: BoxDecoration(
        color: const Color(0xFFF3F3F6),
        borderRadius: BorderRadius.circular(24.r),
        border: Border.all(color: ColorManager.formFieldsBorderColor, width: 1),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                Icons.lock_rounded,
                color: ColorManager.black101828,
                size: 20.sp,
              ),
              Gap(8.w),
              Text(
                Strings.orderLocked.tr(),
                style: getBoldTextStyle(
                  color: ColorManager.black101828,
                  fontSize: FontSizeManager.s20.sp,
                ),
              ),
            ],
          ),
          Gap(12.h),
          Text(
            data.pickupPreparation?.reason.isNotEmpty == true
                ? data.pickupPreparation!.reason
                : Strings.modificationPeriodEnded.tr(),
            style: getRegularTextStyle(
              color: ColorManager.grey6A7282,
              fontSize: FontSizeManager.s16.sp,
            ),
          ),
          const Spacer(),
          Container(
            width: double.infinity,
            height: 56.h,
            decoration: BoxDecoration(
              color: const Color(0xFFE5E7EB),
              borderRadius: BorderRadius.circular(100.r),
            ),
            child: Center(
              child: Text(
                Strings.waitingForKitchen.tr(),
                style: getBoldTextStyle(
                  color: ColorManager.grey6A7282,
                  fontSize: FontSizeManager.s18.sp,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPreparationCard(CurrentSubscriptionOverviewDataModel data) {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.all(24.w),
      decoration: BoxDecoration(
        color: ColorManager.whiteColor,
        borderRadius: BorderRadius.circular(24.r),
        border: Border.all(color: ColorManager.formFieldsBorderColor, width: 1),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Text(
                  Strings.mealsNotPreparedYet.tr(),
                  style: getBoldTextStyle(
                    color: ColorManager.black101828,
                    fontSize: FontSizeManager.s20.sp,
                  ),
                ),
              ),
              Container(
                padding: EdgeInsets.all(8.w),
                decoration: BoxDecoration(
                  color: ColorManager.greenPrimary.withValues(alpha: 0.1),
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  Icons.assignment_turned_in_outlined,
                  color: ColorManager.greenPrimary,
                  size: 24.sp,
                ),
              ),
            ],
          ),
          Gap(12.h),
          Text(
            data.pickupPreparation?.message.isNotEmpty == true
                ? data.pickupPreparation!.message
                : Strings.reviewSelectionToStartPreparation.tr(),
            style: getRegularTextStyle(
              color: ColorManager.grey6A7282,
              fontSize: FontSizeManager.s16.sp,
            ),
          ),
          Gap(24.h),
          SizedBox(
            width: double.infinity,
            height: 56.h,
            child: ElevatedButton(
              onPressed: () {},
              style: ElevatedButton.styleFrom(
                backgroundColor: ColorManager.greenPrimary,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(100.r),
                ),
                elevation: 0,
              ),
              child: Text(
                Strings.confirmAndPrepare.tr(),
                style: getBoldTextStyle(
                  color: Colors.white,
                  fontSize: FontSizeManager.s18.sp,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
