import 'package:flutter/material.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:basic_diet/app/dependency_injection.dart';
import 'package:basic_diet/presentation/plans/plans_bloc.dart';
import 'package:basic_diet/presentation/plans/plans_event.dart';
import 'package:basic_diet/presentation/plans/plans_state.dart';
import 'package:basic_diet/domain/model/current_subscription_overview_model.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';
import 'package:basic_diet/presentation/plans/manage_subscription/manage_subscription_screen.dart';

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
                      return Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          _buildSubscriptionPlanCard(context, data),
                          Gap(AppSize.s16.h),
                          _buildActionButtons(),
                          Gap(AppSize.s16.h),
                          _buildSubscriptionPeriodCard(data),
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
              Strings.mySubscription,
              style: getBoldTextStyle(
                color: ColorManager.black101828,
                fontSize: FontSizeManager.s22.sp,
              ),
            ),
            Gap(AppSize.s4.h),
            Text(
              Strings.welcomeBack,
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
                Strings.subscriptionPlanText,
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
              data.statusLabel.isNotEmpty ? data.statusLabel : Strings.active,
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
                Strings.regularMealsRemaining,
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
                                  Strings.premiumMealsText,
                                  style: getRegularTextStyle(
                                    color: ColorManager.grey6A7282,
                                    fontSize: FontSizeManager.s14.sp,
                                  ),
                                ),
                                Text(
                                  "${premium.remainingQtyTotal} ${Strings.available}",
                                  style: getBoldTextStyle(
                                    color: ColorManager.grey4A5565,
                                    fontSize: FontSizeManager.s14.sp,
                                  ),
                                ),
                              ],
                            ),
                            Gap(AppSize.s4.h),
                            Text(
                              "${Strings.purchased} ${premium.purchasedQtyTotal} • ${Strings.consumed} ${premium.consumedQtyTotal}",
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
              Strings.addOnsIncluded,
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
                    "${addon.name} • 1/day",
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
                    : Strings.pickup,
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
                "${data.selectedMealsPerDay} Meals/day",
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

  Widget _buildActionButtons() {
    return Row(
      children: [
        Expanded(
          child: ElevatedButton(
            onPressed: () {},
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
                  Strings.viewTimeline,
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
                  Strings.todaysMeals,
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
            Strings.subscriptionPeriodText,
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
                    Strings.startDate,
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
                    Strings.endDate,
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
}
