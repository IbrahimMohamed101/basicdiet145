import 'package:basic_diet/app/dependency_injection.dart';
import 'package:basic_diet/domain/model/popular_packages_model.dart';
import 'package:basic_diet/presentation/main/home/bloc/home_bloc.dart';
import 'package:basic_diet/presentation/main/home/bloc/home_event.dart';
import 'package:basic_diet/presentation/main/home/bloc/home_state.dart';
import 'package:basic_diet/presentation/main/subscription/subscription_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:basic_diet/presentation/resources/assets_manager.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:gap/gap.dart';
import 'package:go_router/go_router.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (context) => instance<HomeBloc>()..add(GetPopularPackagesEvent()),
      child: Scaffold(
        backgroundColor: ColorManager.whiteColor,
        body: SafeArea(
          child: SingleChildScrollView(
            padding: EdgeInsetsDirectional.all(AppPadding.p20.w),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _buildHeader(),
                Gap(AppSize.s30.h),
                _buildCardsRow(context),
                Gap(AppSize.s30.h),
                _buildQuickBrowseSection(),
                Gap(AppSize.s30.h),
                BlocBuilder<HomeBloc, HomeState>(
                  builder: (context, state) {
                    if (state is HomePopularPackagesSuccessState) {
                      return _buildPopularPackagesSection(
                          state.popularPackages.packages);
                    } else if (state is HomeLoadingState) {
                      return const Center(
                        child: CircularProgressIndicator(
                          color: ColorManager.greenPrimary,
                        ),
                      );
                    } else if (state is HomeErrorState) {
                      return Center(
                        child: Text(
                          state.message,
                          style: getRegularTextStyle(
                            color: ColorManager.errorColor,
                            fontSize: FontSizeManager.s14.sp,
                          ),
                        ),
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
              Strings.goodMorning,
              style: getBoldTextStyle(
                fontSize: FontSizeManager.s24,
                color: ColorManager.blackColor,
              ),
            ),
            Gap(AppSize.s4.h),
            Text(
              Strings.eatHealthyFeelGreat,
              style: getRegularTextStyle(
                fontSize: FontSizeManager.s14,
                color: ColorManager.grayColor,
              ),
            ),
          ],
        ),
        const Spacer(),
        _buildIconButton(IconAssets.notification),
        Gap(AppSize.s12.w),
        _buildCartButton(),
      ],
    );
  }

  Widget _buildIconButton(String icon) {
    return Container(
      padding: EdgeInsetsDirectional.all(AppPadding.p8.w),
      decoration: BoxDecoration(
        color: const Color(0xFFF9FAFB),
        shape: BoxShape.rectangle,
        borderRadius: BorderRadius.circular(AppSize.s16.r),
      ),
      child: SvgPicture.asset(icon),
    );
  }

  Widget _buildCartButton() {
    return Container(
      padding: EdgeInsetsDirectional.all(AppPadding.p8.w),
      decoration: BoxDecoration(
        color: ColorManager.greenDark,
        shape: BoxShape.rectangle,
        borderRadius: BorderRadius.circular(AppSize.s16.r),
      ),
      child: const Icon(
        Icons.shopping_cart_outlined,
        color: ColorManager.whiteColor,
        size: AppSize.s24,
      ),
    );
  }

  Widget _buildCardsRow(BuildContext context) {
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(child: _buildSubscribeCard(context)),
          Gap(AppSize.s16.w),
          Expanded(child: _buildImageCard()),
        ],
      ),
    );
  }

  Widget _buildSubscribeCard(BuildContext context) {
    return InkWell(
      onTap: () => context.push(SubscriptionScreen.subscriptionRoute),
      child: Container(
        padding: EdgeInsetsDirectional.symmetric(
          horizontal: AppPadding.p20.w,
          vertical: AppPadding.p28.h,
        ),
        decoration: BoxDecoration(
          color: ColorManager.greenDark,
          borderRadius: BorderRadius.circular(AppSize.s16.r),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  padding: EdgeInsetsDirectional.all(AppPadding.p12.w),
                  decoration: BoxDecoration(
                    color: ColorManager.whiteColor.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(AppSize.s16.r),
                  ),
                  child: SvgPicture.asset(
                    IconAssets.increase,
                    colorFilter: const ColorFilter.mode(
                      ColorManager.whiteColor,
                      BlendMode.srcIn,
                    ),
                    width: AppSize.s24.w,
                    height: AppSize.s24.h,
                  ),
                ),
                Container(
                  height: AppSize.s45.h,
                  width: AppSize.s45.w,
                  padding: EdgeInsetsDirectional.all(AppPadding.p8.w),
                  decoration: BoxDecoration(
                    color: ColorManager.whiteColor.withValues(alpha: 0.9),
                    borderRadius: BorderRadius.circular(AppSize.s10.r),
                  ),
                  child: Text(
                    Strings.save20,
                    textAlign: TextAlign.center,
                    style: getBoldTextStyle(
                      fontSize: FontSizeManager.s10.sp,
                      color: ColorManager.greenDark,
                    ).copyWith(height: 1.2),
                  ),
                ),
              ],
            ),
            Gap(AppSize.s20.h),
            Text(
              Strings.subscribeAndSave,
              style: getBoldTextStyle(
                fontSize: FontSizeManager.s18.sp,
                color: ColorManager.whiteColor,
              ).copyWith(height: 1.2),
            ),
            Gap(AppSize.s8.h),
            Text(
              Strings.personalizedDailyPlans,
              style: getRegularTextStyle(
                fontSize: FontSizeManager.s12.sp,
                color: ColorManager.whiteColor.withValues(alpha: 0.8),
              ).copyWith(height: 1.2),
            ),
            const Spacer(),
            Gap(AppSize.s16.h),
            Row(
              children: [
                Text(
                  Strings.viewPlans,
                  style: getBoldTextStyle(
                    fontSize: FontSizeManager.s12.sp,
                    color: ColorManager.whiteColor,
                  ).copyWith(letterSpacing: 1),
                ),
                Gap(AppSize.s4.w),
                const Icon(
                  Icons.arrow_forward_rounded,
                  color: ColorManager.whiteColor,
                  size: AppSize.s16,
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildImageCard() {
    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(AppSize.s16),
        image: const DecorationImage(
          image: AssetImage(ImageAssets.salad),
          fit: BoxFit.cover,
        ),
      ),
    );
  }

  Widget _buildQuickBrowseSection() {
    return Column(
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              Strings.quickBrowse,
              style: getBoldTextStyle(
                fontSize: FontSizeManager.s18,
                color: ColorManager.blackColor,
              ),
            ),
            Text(
              Strings.seeAll,
              style: getBoldTextStyle(
                fontSize: FontSizeManager.s12.sp,
                color: ColorManager.greenDark,
              ).copyWith(letterSpacing: 1),
            ),
          ],
        ),
        Gap(AppSize.s20.h),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            _buildCategoryItem(Strings.readyMeals, ImageAssets.soup),
            _buildCategoryItem(Strings.snacksCategory, ImageAssets.snacks),
            _buildCategoryItem(Strings.dessertsCategory, ImageAssets.desserts),
            _buildCategoryItem(Strings.drinksCategory, ImageAssets.drinks),
          ],
        ),
      ],
    );
  }

  Widget _buildCategoryItem(String title, String imagePath) {
    return Column(
      children: [
        Container(
          width: AppSize.s70.w,
          height: AppSize.s70.h,
          decoration: BoxDecoration(
            color: const Color(0xFFF9FAFB),
            borderRadius: BorderRadius.circular(AppSize.s16.r),
          ),
          child: Center(
            child: Image.asset(
              imagePath,
              width: AppSize.s30.w,
              height: AppSize.s30.h,
              fit: BoxFit.contain,
            ),
          ),
        ),
        Gap(AppSize.s8.h),
        Text(
          title,
          style: getBoldTextStyle(
            fontSize: FontSizeManager.s12.sp,
            color: ColorManager.grayColor,
          ),
        ),
      ],
    );
  }

  Widget _buildPopularPackagesSection(List<PopularPackageModel> packages) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              Strings.popularPackages,
              style: getBoldTextStyle(
                fontSize: FontSizeManager.s18.sp,
                color: ColorManager.blackColor,
              ),
            ),
            Text(
              Strings.seeAll,
              style: getBoldTextStyle(
                fontSize: FontSizeManager.s12.sp,
                color: ColorManager.greenDark,
              ).copyWith(letterSpacing: 1),
            ),
          ],
        ),
        Gap(AppSize.s20.h),
        ...packages.map((package) {
          return Padding(
            padding: EdgeInsets.only(bottom: AppSize.s16.h),
            child: _buildPackageCard(
              title: package.name,
              tagText: Strings.mostPopular, // Default tag, could be dynamic
              mealsDesc: "${package.mealsPerDay} meals per day - ${package.daysCount} days",
              price: "${package.newPrice.toStringAsFixed(2)} ${package.currency}",
              originalPrice: "${package.oldPrice.toStringAsFixed(2)} ${package.currency}",
              saveAmount: "Save ${package.moneySave.toStringAsFixed(2)} ${package.currency}",
            ),
          );
        }),
      ],
    );
  }

  Widget _buildPackageCard({
    required String title,
    required String tagText,
    required String mealsDesc,
    required String price,
    required String originalPrice,
    required String saveAmount,
  }) {
    return Container(
      padding: EdgeInsetsDirectional.all(AppPadding.p16.w),
      decoration: BoxDecoration(
        color: ColorManager.whiteColor,
        borderRadius: BorderRadius.circular(AppSize.s16.r),
        border: Border.all(
          color: ColorManager.formFieldsBorderColor,
          width: AppSize.s1,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      fontFamily: 'Inter',
                      fontWeight: FontWeight.w700,
                      fontSize: FontSizeManager.s16.sp,
                      height: 24 / 16,
                      letterSpacing: 0,
                      color: ColorManager.black101828,
                    ),
                  ),
                  Gap(AppSize.s8.w),
                  Container(
                    padding: EdgeInsetsDirectional.symmetric(
                      horizontal: AppPadding.p8.w,
                      vertical: AppSize.s4.h,
                    ),
                    decoration: BoxDecoration(
                      color: ColorManager.orangeF54900.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(AppSize.s8.r),
                    ),
                    child: Text(
                      tagText,
                      style: TextStyle(
                        fontFamily: 'Inter',
                        fontWeight: FontWeight.w700,
                        fontSize: 9.sp,
                        height: 13.5 / 9,
                        letterSpacing: 0,
                        color: ColorManager.orangeF54900,
                      ),
                    ),
                  ),
                ],
              ),
              SvgPicture.asset(
                IconAssets.star,
                width: AppSize.s24.w,
                height: AppSize.s24.h,
              ),
            ],
          ),
          Gap(AppSize.s8.h),
          Text(
            mealsDesc,
            style: TextStyle(
              fontFamily: 'Inter',
              fontWeight: FontWeight.w400,
              fontSize: FontSizeManager.s12.sp,
              height: 16 / 12,
              letterSpacing: 0,
              color: ColorManager.grey6A7282,
            ),
          ),
          Gap(AppSize.s16.h),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    price,
                    style: TextStyle(
                      fontFamily: 'Inter',
                      fontWeight: FontWeight.w700,
                      fontSize: FontSizeManager.s20.sp,
                      height: 28 / 20,
                      letterSpacing: 0,
                      color: ColorManager.greenDark,
                    ),
                  ),
                  Gap(AppSize.s8.w),
                  Padding(
                    padding: EdgeInsetsDirectional.only(bottom: AppSize.s2.h),
                    child: Text(
                      originalPrice,
                      style: TextStyle(
                        fontFamily: 'Inter',
                        fontWeight: FontWeight.w400,
                        fontSize: FontSizeManager.s14.sp,
                        color: ColorManager.grayColor.withValues(alpha: 0.6),
                        decoration: TextDecoration.lineThrough,
                      ),
                    ),
                  ),
                ],
              ),
              Container(
                padding: EdgeInsetsDirectional.symmetric(
                  horizontal: AppPadding.p12.w,
                  vertical: AppPadding.p8.h,
                ),
                decoration: BoxDecoration(
                  color: ColorManager.greenPrimary.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(AppSize.s16.r),
                ),
                child: Text(
                  saveAmount,
                  style: TextStyle(
                    fontFamily: 'Inter',
                    fontWeight: FontWeight.w700,
                    fontSize: FontSizeManager.s12.sp,
                    color: ColorManager.greenDark,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
