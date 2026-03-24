import 'package:basic_diet/app/dependency_injection.dart';
import 'package:basic_diet/domain/model/premium_meals_model.dart';
import 'package:basic_diet/presentation/main/home/premium/bloc/premium_meals_bloc.dart';
import 'package:basic_diet/presentation/main/home/premium/bloc/premium_meals_event.dart';
import 'package:basic_diet/presentation/main/home/premium/bloc/premium_meals_state.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';
import 'package:basic_diet/presentation/main/home/add-ons/add_ons_screen.dart';

class PremiumMealsScreen extends StatelessWidget {
  static const String premiumRoute = '/premium_meals';

  const PremiumMealsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (context) => instance<PremiumMealsBloc>()..add(const GetPremiumMealsEvent()),
      child: Scaffold(
        backgroundColor: const Color(0xFFF9FAFB),
        appBar: _buildAppBar(context),
        body: SafeArea(
          child: BlocBuilder<PremiumMealsBloc, PremiumMealsState>(
            builder: (context, state) {
              if (state is PremiumMealsLoading) {
                return const Center(
                  child: CircularProgressIndicator(
                    color: ColorManager.greenPrimary,
                  ),
                );
              } else if (state is PremiumMealsError) {
                return Center(
                  child: Text(
                    state.message,
                    style: getRegularTextStyle(color: ColorManager.errorColor),
                  ),
                );
              } else if (state is PremiumMealsSuccess) {
                return Column(
                  children: [
                    Expanded(
                      child: SingleChildScrollView(
                        padding: EdgeInsetsDirectional.symmetric(
                          horizontal: AppPadding.p16.w,
                          vertical: AppPadding.p20.h,
                        ),
                        child: Column(
                          children: [
                            const _PremiumInfoBanner(),
                            Gap(AppSize.s16.h),
                            ...state.premiumMealsModel.meals.map((meal) {
                              final quantity = state.mealCounters[meal.id] ?? 0;
                              return Padding(
                                padding: EdgeInsets.only(bottom: AppSize.s16.h),
                                child: _PremiumMealCard(
                                  meal: meal,
                                  quantity: quantity,
                                  onIncrement: () {
                                    context.read<PremiumMealsBloc>().add(
                                      UpdateMealCounterEvent(meal.id, quantity + 1)
                                    );
                                  },
                                  onDecrement: () {
                                    if (quantity > 0) {
                                      context.read<PremiumMealsBloc>().add(
                                        UpdateMealCounterEvent(meal.id, quantity - 1)
                                      );
                                    }
                                  },
                                ),
                              );
                            }),
                          ],
                        ),
                      ),
                    ),
                    const _BottomActions(),
                  ],
                );
              }
              return const SizedBox.shrink();
            },
          ),
        ),
      ),
    );
  }

  AppBar _buildAppBar(BuildContext context) {
    return AppBar(
      backgroundColor: ColorManager.whiteColor,
      elevation: 0,
      centerTitle: false,
      titleSpacing: 0,
      leading: IconButton(
        onPressed: () => Navigator.pop(context),
        icon: Icon(
          Icons.arrow_back,
          color: ColorManager.blackColor,
          size: AppSize.s24.sp,
        ),
      ),
      title: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            Strings.premiumMeals,
            style: getBoldTextStyle(
              color: ColorManager.black101828,
              fontSize: FontSizeManager.s18.sp,
            ),
          ),
          Gap(AppSize.s2.h),
          Text(
            Strings.exclusiveProteins,
            style: getRegularTextStyle(
              color: ColorManager.grey6A7282,
              fontSize: FontSizeManager.s12.sp,
            ),
          ),
        ],
      ),
      actions: [
        Padding(
          padding: EdgeInsetsDirectional.symmetric(
            horizontal: AppPadding.p16.w,
          ),
          child: Container(
            width: AppSize.s40.w,
            height: AppSize.s40.w,
            decoration: const BoxDecoration(
              color: ColorManager.greenDark,
              shape: BoxShape.circle,
            ),
            child: Icon(
              Icons.star_rounded,
              color: ColorManager.whiteColor,
              size: AppSize.s24.sp,
            ),
          ),
        ),
      ],
    );
  }
}

class _PremiumInfoBanner extends StatelessWidget {
  const _PremiumInfoBanner();

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: ColorManager.orangeFFF5EC,
        borderRadius: BorderRadius.circular(AppSize.s12.r),
      ),
      child: IntrinsicHeight(
        child: Row(
          children: [
            Container(
              width: AppSize.s4.w,
              decoration: BoxDecoration(
                color: ColorManager.greenDark,
                borderRadius: BorderRadius.only(
                  topLeft: Radius.circular(AppSize.s12.r),
                  bottomLeft: Radius.circular(AppSize.s12.r),
                ),
              ),
            ),
            Expanded(
              child: Padding(
                padding: EdgeInsetsDirectional.all(AppPadding.p16.w),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          padding: EdgeInsetsDirectional.all(AppSize.s4.w),
                          decoration: const BoxDecoration(
                            color: ColorManager.greenDark,
                            shape: BoxShape.circle,
                          ),
                          child: Icon(
                            Icons.star_rounded,
                            color: ColorManager.whiteColor,
                            size: AppSize.s16.sp,
                          ),
                        ),
                        Gap(AppSize.s8.w),
                        Text(
                          Strings.premiumProteinSelection,
                          style: getBoldTextStyle(
                            color: ColorManager.black101828,
                            fontSize: FontSizeManager.s14.sp,
                          ),
                        ),
                      ],
                    ),
                    Gap(AppSize.s8.h),
                    Text(
                      Strings.premiumProteinDesc,
                      style: getRegularTextStyle(
                        color: ColorManager.grey6A7282,
                        fontSize: FontSizeManager.s12.sp,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PremiumMealCard extends StatelessWidget {
  final PremiumMealModel meal;
  final int quantity;
  final VoidCallback onIncrement;
  final VoidCallback onDecrement;

  const _PremiumMealCard({
    required this.meal,
    required this.quantity,
    required this.onIncrement,
    required this.onDecrement,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: ColorManager.whiteColor,
        borderRadius: BorderRadius.circular(AppSize.s16.r),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.03),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.vertical(
              top: Radius.circular(AppSize.s16.r),
            ),
            child: Image.network(meal.imageUrl, height: 180.h, fit: BoxFit.cover, errorBuilder: (context, error, stackTrace) {
              return Container(
                height: 180.h,
                color: ColorManager.greyF3F4F6,
                child: Center(
                  child: Icon(
                    Icons.image_not_supported,
                    color: ColorManager.grey6A7282,
                  ),
                ),
              );
            }),
          ),
          Padding(
            padding: EdgeInsetsDirectional.all(AppPadding.p16.w),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  meal.ui.title,
                  style: getBoldTextStyle(
                    color: ColorManager.black101828,
                    fontSize: FontSizeManager.s16.sp,
                  ).copyWith(height: 24 / 16),
                ),
                Gap(AppSize.s8.h),
                Text(
                  meal.ui.subtitle,
                  style: getRegularTextStyle(
                    color: ColorManager.grey4A5565,
                    fontSize: FontSizeManager.s14.sp,
                  ).copyWith(height: 22.75 / 14),
                ),
                Gap(AppSize.s16.h),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      meal.priceLabel,
                      style: getBoldTextStyle(
                        color: ColorManager.greenDark,
                        fontSize: FontSizeManager.s24.sp,
                      ).copyWith(height: 32 / 24),
                    ),
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        _CounterButton(
                          icon: Icons.remove,
                          onPressed: quantity > 0 ? onDecrement : null,
                          backgroundColor: ColorManager.greyF3F4F6,
                          iconColor: ColorManager.black101828,
                        ),
                        SizedBox(
                          width: AppSize.s34.w,
                          child: Text(
                            quantity.toString(),
                            textAlign: TextAlign.center,
                            style: getBoldTextStyle(
                              color: ColorManager.black101828,
                              fontSize: FontSizeManager.s18.sp,
                            ).copyWith(height: 28 / 18),
                          ),
                        ),
                        _CounterButton(
                          icon: Icons.add,
                          onPressed: onIncrement,
                          backgroundColor: ColorManager.greenDark,
                          iconColor: ColorManager.whiteColor,
                        ),
                      ],
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _CounterButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback? onPressed;
  final Color backgroundColor;
  final Color iconColor;

  const _CounterButton({
    required this.icon,
    this.onPressed,
    required this.backgroundColor,
    required this.iconColor,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onPressed,
      child: Container(
        width: AppSize.s34.w,
        height: AppSize.s34.w,
        decoration: BoxDecoration(
          color: onPressed != null
              ? backgroundColor
              : backgroundColor.withOpacity(0.5),
          borderRadius: BorderRadius.circular(AppSize.s10.r),
        ),
        child: Icon(
          icon,
          color: onPressed != null ? iconColor : iconColor.withOpacity(0.5),
          size: AppSize.s20.sp,
        ),
      ),
    );
  }
}

class _BottomActions extends StatelessWidget {
  const _BottomActions();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsetsDirectional.symmetric(
        horizontal: AppPadding.p20.w,
        vertical: AppPadding.p16.h,
      ),
      decoration: BoxDecoration(
        color: ColorManager.whiteColor,
        border: Border(
          top: BorderSide(color: ColorManager.formFieldsBorderColor, width: 1),
        ),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ElevatedButton(
            onPressed: () {
              Navigator.push(
                context,
                MaterialPageRoute(builder: (context) => const AddOnsScreen()),
              );
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: ColorManager.greenPrimary,
              minimumSize: Size(double.infinity, 56.h),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(AppSize.s16.r),
              ),
              elevation: 0,
            ),
            child: Text(
              Strings.continueText,
              style: getBoldTextStyle(
                fontSize: FontSizeManager.s16.sp,
                color: ColorManager.whiteColor,
              ),
            ),
          ),
          Gap(AppSize.s12.h),
          TextButton(
            onPressed: () {
              Navigator.push(
                context,
                MaterialPageRoute(builder: (context) => const AddOnsScreen()),
              );
            },
            style: TextButton.styleFrom(
              minimumSize: Size(double.infinity, 48.h),
            ),
            child: Text(
              Strings.skipThisStep,
              style: getBoldTextStyle(
                fontSize: FontSizeManager.s16.sp,
                color: ColorManager.black101828,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
