import 'package:basic_diet/app/dependency_injection.dart';
import 'package:basic_diet/domain/model/plans_model.dart';
import 'package:basic_diet/presentation/main/subscription/bloc/subscription_bloc.dart';
import 'package:basic_diet/presentation/main/subscription/bloc/subscription_event.dart';
import 'package:basic_diet/presentation/main/subscription/bloc/subscription_state.dart';
import 'package:basic_diet/presentation/resources/assets_manager.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';

class SubscriptionScreen extends StatelessWidget {
  static const String subscriptionRoute = '/subscription';

  const SubscriptionScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (context) =>
          instance<SubscriptionBloc>()..add(const GetPlansEvent()),
      child: Scaffold(
        backgroundColor: ColorManager.whiteColor,
        appBar: AppBar(
          backgroundColor: ColorManager.whiteColor,
          elevation: 0,
          centerTitle: false,
          leading: IconButton(
            onPressed: () => Navigator.pop(context),
            icon: Icon(
              Icons.keyboard_arrow_left,
              color: ColorManager.blackColor,
              size: AppSize.s30.sp,
            ),
          ),
          title: Text(
            Strings.subscriptionPackages,
            style: getBoldTextStyle(
              color: ColorManager.black101828,
              fontSize: FontSizeManager.s20.sp,
            ),
          ),
        ),
        body: SafeArea(
          child: Column(
            children: [
              Expanded(
                child: BlocBuilder<SubscriptionBloc, SubscriptionState>(
                  builder: (context, state) {
                    if (state is SubscriptionLoading) {
                      return const Center(
                          child: CircularProgressIndicator(
                        color: ColorManager.greenPrimary,
                      ));
                    } else if (state is SubscriptionSuccess) {
                      return _SubscriptionContentView(
                          plansModel: state.plansModel);
                    } else if (state is SubscriptionError) {
                      return Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(state.message),
                            Gap(AppSize.s16.h),
                            ElevatedButton(
                              onPressed: () {
                                context
                                    .read<SubscriptionBloc>()
                                    .add(const GetPlansEvent());
                              },
                              child: const Text("Try Again"),
                            ),
                          ],
                        ),
                      );
                    }
                    return const SizedBox.shrink();
                  },
                ),
              ),
              _buildProceedButton(),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildProceedButton() {
    return Container(
      padding: EdgeInsetsDirectional.all(AppPadding.p20.w),
      color: ColorManager.whiteColor,
      child: ElevatedButton(
        onPressed: () {},
        style: ElevatedButton.styleFrom(
          backgroundColor: ColorManager.greenPrimary,
          minimumSize: Size(double.infinity, 56.h),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppSize.s16.r),
          ),
          elevation: 0,
        ),
        child: Text(
          Strings.choosePackageProceed,
          style: TextStyle(
            fontFamily: 'Inter',
            fontWeight: FontWeight.w700,
            fontSize: FontSizeManager.s16.sp,
            color: ColorManager.whiteColor,
          ),
        ),
      ),
    );
  }
}

class _SubscriptionContentView extends StatefulWidget {
  final PlansModel plansModel;

  const _SubscriptionContentView({required this.plansModel});

  @override
  State<_SubscriptionContentView> createState() =>
      _SubscriptionContentViewState();
}

class _SubscriptionContentViewState extends State<_SubscriptionContentView> {
  int _expandedIndex = -1;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: EdgeInsetsDirectional.symmetric(
        horizontal: AppPadding.p20.w,
      ),
      children: [
        Gap(AppSize.s20.h),
        _buildImageBanner(),
        Gap(AppSize.s20.h),
        Center(
          child: Text(
            Strings.vatAndDelivery,
            style: getRegularTextStyle(
              color: ColorManager.grayColor,
              fontSize: FontSizeManager.s14.sp,
            ),
          ),
        ),
        Gap(AppSize.s8.h),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            _buildBenefitItem(Strings.dailyDelivery),
            Gap(AppSize.s8.w),
            _buildBenefitItem(Strings.variedMenu),
            Gap(AppSize.s8.w),
            _buildBenefitItem(Strings.guaranteedQuality),
          ],
        ),
        Gap(AppSize.s30.h),
        ...List.generate(widget.plansModel.plans.length, (index) {
          return Padding(
            padding: EdgeInsetsDirectional.only(
              bottom: AppSize.s16.h,
            ),
            child: _buildPackageItem(index, widget.plansModel.plans[index]),
          );
        }),
      ],
    );
  }

  Widget _buildImageBanner() {
    return Container(
      width: double.infinity,
      height: 200.h,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(AppSize.s30.r),
        image: const DecorationImage(
          image: AssetImage(ImageAssets.subscription),
          fit: BoxFit.cover,
        ),
      ),
      child: Container(
        padding: EdgeInsetsDirectional.all(AppPadding.p20.w),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(AppSize.s30.r),
          gradient: LinearGradient(
            begin: Alignment.bottomCenter,
            end: Alignment.topCenter,
            colors: [Colors.black.withValues(alpha: 0.8), Colors.transparent],
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.end,
          children: [
            Container(
              padding: EdgeInsetsDirectional.symmetric(
                horizontal: AppPadding.p12.w,
                vertical: AppSize.s4.h,
              ),
              decoration: BoxDecoration(
                color: ColorManager.greenPrimary,
                borderRadius: BorderRadius.circular(AppSize.s20.r),
              ),
              child: Text(
                Strings.new2026Packages,
                style: getBoldTextStyle(
                  color: ColorManager.whiteColor,
                  fontSize: FontSizeManager.s12.sp,
                ),
              ),
            ),
            Gap(AppSize.s8.h),
            Text(
              Strings.subscriptionPricingMenu,
              style: getBoldTextStyle(
                color: ColorManager.whiteColor,
                fontSize: FontSizeManager.s24.sp,
              ).copyWith(height: 1.2),
            ),
            Gap(AppSize.s4.h),
            Text(
              Strings.choosePackageHealthGoals,
              style: getRegularTextStyle(
                color: ColorManager.whiteColor.withValues(alpha: 0.9),
                fontSize: FontSizeManager.s12.sp,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildBenefitItem(String text) {
    return Row(
      children: [
        Icon(
          Icons.check,
          color: ColorManager.greenPrimary,
          size: AppSize.s16.sp,
        ),
        Gap(AppSize.s4.w),
        Text(
          text,
          style: getRegularTextStyle(
            color: ColorManager.grey6A7282,
            fontSize: FontSizeManager.s10.sp,
          ),
        ),
      ],
    );
  }

  Widget _buildPackageItem(int index, PlanModel plan) {
    final bool isExpanded = _expandedIndex == index;

    return GestureDetector(
      onTap: () {
        setState(() {
          if (_expandedIndex == index) {
            _expandedIndex = -1;
          } else {
            _expandedIndex = index;
          }
        });
      },
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 300),
        decoration: BoxDecoration(
          color: ColorManager.whiteColor,
          borderRadius: BorderRadius.circular(AppSize.s16.r),
          border: Border.all(
            color: isExpanded
                ? ColorManager.greenPrimary.withValues(alpha: 0.3)
                : const Color(0xFFF2F4F7),
            width: AppSize.s1,
          ),
          boxShadow: [
            if (!isExpanded)
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.02),
                blurRadius: 10,
                offset: const Offset(0, 4),
              ),
          ],
        ),
        child: Column(
          children: [
            Padding(
              padding: EdgeInsetsDirectional.all(AppPadding.p16.w),
              child: Row(
                children: [
                  Container(
                    width: AppSize.s40.w,
                    height: AppSize.s40.h,
                    decoration: BoxDecoration(
                      color: ColorManager.greenPrimary.withValues(alpha: 0.1),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      Icons.calendar_today_outlined,
                      color: ColorManager.greenPrimary,
                      size: AppSize.s20.w,
                    ),
                  ),
                  Gap(AppSize.s16.w),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          plan.name,
                          style: TextStyle(
                            fontFamily: 'Inter',
                            fontWeight: FontWeight.w700,
                            fontSize: FontSizeManager.s16.sp,
                            color: ColorManager.black101828,
                          ),
                        ),
                        Gap(AppSize.s4.h),
                        Text(
                          Strings.chooseDailyMealCount,
                          style: TextStyle(
                            fontFamily: 'Inter',
                            fontWeight: FontWeight.w400,
                            fontSize: FontSizeManager.s12.sp,
                            color: ColorManager.grey6A7282,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Icon(
                    isExpanded
                        ? Icons.keyboard_arrow_up
                        : Icons.keyboard_arrow_down,
                    color: ColorManager.greenPrimary,
                  ),
                ],
              ),
            ),
            if (isExpanded) _buildExpandedContent(plan),
          ],
        ),
      ),
    );
  }

  Widget _buildExpandedContent(PlanModel plan) {
    return Padding(
      padding: EdgeInsetsDirectional.only(
        start: AppPadding.p16.w,
        end: AppPadding.p16.w,
        bottom: AppPadding.p16.h,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: AppSize.s4.w,
                height: 50.h,
                decoration: BoxDecoration(
                  color: ColorManager.greenPrimary,
                  borderRadius: BorderRadius.circular(AppSize.s4.r),
                ),
              ),
              Gap(AppSize.s12.w),
              Expanded(
                child: Text(
                  Strings.perfectForTrying,
                  style: TextStyle(
                    fontFamily: 'Inter',
                    fontWeight: FontWeight.w400,
                    fontSize: FontSizeManager.s12.sp,
                    color: ColorManager.black101828.withValues(alpha: 0.8),
                    height: 1.5,
                  ),
                ),
              ),
            ],
          ),
          Gap(AppSize.s20.h),
          ...plan.gramsOptions.map((gramOption) => _buildSizeSection(gramOption)),
        ],
      ),
    );
  }

  Widget _buildSizeSection(GramOptionModel gramOption) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Container(
              padding: EdgeInsetsDirectional.all(AppSize.s4.w),
              decoration: BoxDecoration(
                color: ColorManager.greenPrimary.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(AppSize.s8.r),
              ),
              child: Icon(
                Icons.restaurant_menu,
                color: ColorManager.greenPrimary,
                size: AppSize.s14.sp,
              ),
            ),
            Gap(AppSize.s10.w),
            Text(
              "${gramOption.grams}g Size",
              style: getBoldTextStyle(
                color: ColorManager.black101828,
                fontSize: FontSizeManager.s14.sp,
              ),
            ),
          ],
        ),
        Gap(AppSize.s12.h),
        _buildOptionsGrid(gramOption.mealsOptions),
        Gap(AppSize.s24.h),
      ],
    );
  }

  Widget _buildOptionsGrid(List<MealOptionModel> options) {
    return Column(
      children: [
        for (int i = 0; i < options.length; i += 2)
          Padding(
            padding: EdgeInsetsDirectional.only(
              bottom: (i + 2 < options.length || i + 1 < options.length)
                  ? AppSize.s12.h
                  : 0,
            ),
            child: Row(
              children: [
                Expanded(child: _buildMealOptionCard(options[i])),
                if (i + 1 < options.length) ...[
                  Gap(AppSize.s12.w),
                  Expanded(child: _buildMealOptionCard(options[i + 1])),
                ],
              ],
            ),
          ),
      ],
    );
  }

  Widget _buildMealOptionCard(MealOptionModel option) {
    return Container(
      padding: EdgeInsetsDirectional.all(AppPadding.p12.w),
      decoration: BoxDecoration(
        color: ColorManager.whiteColor,
        borderRadius: BorderRadius.circular(AppSize.s12.r),
        border: Border.all(color: const Color(0xFFF2F4F7), width: AppSize.s1),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            "${option.mealsPerDay} Meal${option.mealsPerDay > 1 ? 's' : ''}",
            style: TextStyle(
              fontFamily: 'Inter',
              fontWeight: FontWeight.w400,
              fontSize: FontSizeManager.s12.sp,
              color: ColorManager.grey6A7282,
            ),
          ),
          Gap(AppSize.s8.h),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(
                option.priceSar.toStringAsFixed(0),
                style: TextStyle(
                  fontFamily: 'Inter',
                  fontWeight: FontWeight.w700,
                  fontSize: FontSizeManager.s18.sp,
                  color: ColorManager.greenPrimary,
                ),
              ),
              Gap(AppSize.s4.w),
              Text(
                Strings.sar,
                style: TextStyle(
                  fontFamily: 'Inter',
                  fontWeight: FontWeight.w700,
                  fontSize: FontSizeManager.s10.sp,
                  color: ColorManager.greenPrimary,
                ),
              ),
            ],
          ),
          Gap(AppSize.s4.h),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(
                option.compareAtSar.toStringAsFixed(0),
                style: TextStyle(
                  fontFamily: 'Inter',
                  fontWeight: FontWeight.w400,
                  fontSize: FontSizeManager.s12.sp,
                  color: ColorManager.grayColor.withValues(alpha: 0.6),
                  decoration: TextDecoration.lineThrough,
                ),
              ),
              Gap(AppSize.s4.w),
              Text(
                Strings.sar,
                style: TextStyle(
                  fontFamily: 'Inter',
                  fontWeight: FontWeight.w400,
                  fontSize: FontSizeManager.s10.sp,
                  color: ColorManager.grayColor.withValues(alpha: 0.6),
                  decoration: TextDecoration.lineThrough,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
