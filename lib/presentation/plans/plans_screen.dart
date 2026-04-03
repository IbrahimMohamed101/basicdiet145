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
                          _buildSubscriptionPlanCard(data),
                          const SizedBox(height: AppSize.s16),
                          _buildActionButtons(),
                          const SizedBox(height: AppSize.s16),
                          _buildSubscriptionPeriodCard(data),
                          const SizedBox(height: AppSize.s24),
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
                fontSize: FontSizeManager.s22,
              ),
            ),
            const SizedBox(height: AppSize.s4),
            Text(
              Strings.welcomeBack,
              style: getRegularTextStyle(
                color: ColorManager.grey6A7282,
                fontSize: FontSizeManager.s14,
              ),
            ),
          ],
        ),
        Container(
          padding: const EdgeInsets.all(AppPadding.p8),
          decoration: BoxDecoration(
            color: ColorManager.greenPrimary.withOpacity(0.1),
            shape: BoxShape.circle,
          ),
          child: const Text(
            '👋',
            style: TextStyle(fontSize: FontSizeManager.s20),
          ),
        ),
      ],
    );
  }

  Widget _buildSubscriptionPlanCard(CurrentSubscriptionOverviewDataModel data) {
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
            color: Colors.black.withOpacity(0.02),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      padding: const EdgeInsets.all(AppPadding.p16),
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
                  fontSize: FontSizeManager.s18,
                ),
              ),
              const Icon(
                Icons.settings_outlined,
                color: ColorManager.grey6A7282,
                size: AppSize.s20,
              ),
            ],
          ),
          const SizedBox(height: AppSize.s16),
          Container(
            padding: const EdgeInsets.symmetric(
              horizontal: AppPadding.p12,
              vertical: AppPadding.p6,
            ),
            decoration: BoxDecoration(
              color: ColorManager.greenPrimary.withOpacity(0.1),
              borderRadius: BorderRadius.circular(AppSize.s20),
            ),
            child: Text(
              data.statusLabel.isNotEmpty ? data.statusLabel : Strings.active,
              style: getBoldTextStyle(
                color: ColorManager.greenPrimary,
                fontSize: FontSizeManager.s12,
              ),
            ),
          ),
          const SizedBox(height: AppSize.s24),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                Strings.regularMealsRemaining,
                style: getRegularTextStyle(
                  color: ColorManager.grey6A7282,
                  fontSize: FontSizeManager.s14,
                ),
              ),
              Text(
                "${data.remainingMeals} / ${data.totalMeals}",
                style: getBoldTextStyle(
                  color: ColorManager.black101828,
                  fontSize: FontSizeManager.s16,
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSize.s8),
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
          const SizedBox(height: AppSize.s24),
          Container(height: 1, color: ColorManager.formFieldsBorderColor),
          const SizedBox(height: AppSize.s20),

          if (data.premiumSummary.isNotEmpty) ...[
            ...data.premiumSummary.map(
              (premium) => Column(
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(
                        padding: const EdgeInsets.all(AppPadding.p8),
                        decoration: BoxDecoration(
                          color: ColorManager.orangePrimary.withOpacity(0.1),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(
                          Icons.workspace_premium_outlined,
                          color: ColorManager.orangePrimary,
                          size: AppSize.s18,
                        ),
                      ),
                      const SizedBox(width: AppSize.s12),
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
                                    fontSize: FontSizeManager.s14,
                                  ),
                                ),
                                Text(
                                  "${premium.remainingQtyTotal} ${Strings.available}",
                                  style: getBoldTextStyle(
                                    color: ColorManager.grey4A5565,
                                    fontSize: FontSizeManager.s14,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: AppSize.s4),
                            Text(
                              "${Strings.purchased} ${premium.purchasedQtyTotal} • ${Strings.consumed} ${premium.consumedQtyTotal}",
                              style: getRegularTextStyle(
                                color: ColorManager.grey6A7282,
                                fontSize: FontSizeManager.s12,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSize.s24),
                ],
              ),
            ),
          ],

          if (data.addonSubscriptions.isNotEmpty) ...[
            Text(
              Strings.addOnsIncluded,
              style: getRegularTextStyle(
                color: ColorManager.grey6A7282,
                fontSize: FontSizeManager.s12,
              ),
            ),
            const SizedBox(height: AppSize.s8),
            Wrap(
              spacing: AppSize.s8,
              runSpacing: AppSize.s8,
              children: data.addonSubscriptions.map((addon) {
                return Container(
                  padding: const EdgeInsets.symmetric(
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
            const SizedBox(height: AppSize.s20),
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
                  fontSize: FontSizeManager.s14,
                ),
              ),
              const SizedBox(width: AppSize.s16),
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
                const SizedBox(width: AppSize.s8),
                Text(
                  Strings.viewTimeline,
                  style: getRegularTextStyle(
                    color: Colors.white,
                    fontSize: FontSizeManager.s14,
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(width: AppSize.s12),
        Expanded(
          child: OutlinedButton(
            onPressed: () {},
            style: OutlinedButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: AppPadding.p16),
              foregroundColor: ColorManager.black101828,
              side: const BorderSide(color: ColorManager.formFieldsBorderColor),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(AppSize.s12),
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
                const SizedBox(width: AppSize.s8),
                Text(
                  Strings.todaysMeals,
                  style: getRegularTextStyle(
                    color: ColorManager.black101828,
                    fontSize: FontSizeManager.s14,
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
        borderRadius: BorderRadius.circular(AppSize.s16),
        border: Border.all(color: ColorManager.formFieldsBorderColor),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.02),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      padding: const EdgeInsets.all(AppPadding.p16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            Strings.subscriptionPeriodText,
            style: getRegularTextStyle(
              color: ColorManager.black101828,
              fontSize: FontSizeManager.s16,
            ),
          ),
          const SizedBox(height: AppSize.s16),
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
                      fontSize: FontSizeManager.s12,
                    ),
                  ),
                  const SizedBox(height: AppSize.s4),
                  Text(
                    startDateFormatted,
                    style: getRegularTextStyle(
                      color: ColorManager.black101828,
                      fontSize: FontSizeManager.s14,
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
                      fontSize: FontSizeManager.s12,
                    ),
                  ),
                  const SizedBox(height: AppSize.s4),
                  Text(
                    endDateFormatted,
                    style: getRegularTextStyle(
                      color: ColorManager.black101828,
                      fontSize: FontSizeManager.s14,
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
