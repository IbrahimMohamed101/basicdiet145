import 'package:basic_diet/presentation/resources/assets_manager.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';

class SubscriptionScreen extends StatefulWidget {
  static const String subscriptionRoute = '/subscription';
  const SubscriptionScreen({super.key});

  @override
  State<SubscriptionScreen> createState() => _SubscriptionScreenState();
}

class _SubscriptionScreenState extends State<SubscriptionScreen> {
  int _expandedIndex = -1;

  final List<Map<String, dynamic>> _packages = [
    {
      'title': Strings.daysWeekly,
      'icon': Icons.calendar_today_outlined,
      'isExpandable': true,
      'sizes': [
        {
          'title': Strings.size100g,
          'options': [
            {'title': Strings.meal1, 'price': '150', 'oldPrice': '180'},
            {'title': Strings.meals2, 'price': '280', 'oldPrice': '320'},
            {'title': Strings.meals3, 'price': '400', 'oldPrice': '450'},
            {'title': Strings.meals4, 'price': '520', 'oldPrice': '580'},
            {'title': Strings.meals5, 'price': '630', 'oldPrice': '700'},
          ],
        },
        {
          'title': Strings.size150g,
          'options': [
            {'title': Strings.meal1, 'price': '195', 'oldPrice': '230'},
            {'title': Strings.meals2, 'price': '350', 'oldPrice': '400'},
            {'title': Strings.meals3, 'price': '490', 'oldPrice': '550'},
            {'title': Strings.meals4, 'price': '630', 'oldPrice': '700'},
            {'title': Strings.meals5, 'price': '750', 'oldPrice': '840'},
          ],
        },
        {
          'title': Strings.size200g,
          'options': [
            {'title': Strings.meal1, 'price': '240', 'oldPrice': '280'},
            {'title': Strings.meals2, 'price': '420', 'oldPrice': '480'},
            {'title': Strings.meals3, 'price': '580', 'oldPrice': '650'},
            {'title': Strings.meals4, 'price': '740', 'oldPrice': '820'},
            {'title': Strings.meals5, 'price': '870', 'oldPrice': '980'},
          ],
        },
      ],
    },
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
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
              child: ListView(
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
                  ...List.generate(_packages.length, (index) {
                    return Padding(
                      padding: EdgeInsetsDirectional.only(
                        bottom: AppSize.s16.h,
                      ),
                      child: _buildPackageItem(index),
                    );
                  }),
                ],
              ),
            ),
            _buildProceedButton(),
          ],
        ),
      ),
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

  Widget _buildPackageItem(int index) {
    final package = _packages[index];
    final bool isExpanded = _expandedIndex == index;
    final bool isExpandable = package['isExpandable'];

    return GestureDetector(
      onTap: () {
        if (isExpandable) {
          setState(() {
            if (_expandedIndex == index) {
              _expandedIndex = -1; // Collapse if already expanded
            } else {
              _expandedIndex = index;
            }
          });
        }
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
                      package['icon'],
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
                          package['title'],
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
                  if (isExpandable)
                    Icon(
                      isExpanded
                          ? Icons.keyboard_arrow_up
                          : Icons.keyboard_arrow_down,
                      color: ColorManager.greenPrimary,
                    ),
                ],
              ),
            ),
            if (isExpanded) _buildExpandedContent(package),
          ],
        ),
      ),
    );
  }

  Widget _buildExpandedContent(Map<String, dynamic> package) {
    final sizes = package['sizes'] as List<Map<String, dynamic>>?;
    final options = package['options'] as List<dynamic>?;

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
          if (sizes != null)
            ...sizes.map((size) => _buildSizeSection(size))
          else if (options != null)
            _buildOptionsGrid(options),
        ],
      ),
    );
  }

  Widget _buildSizeSection(Map<String, dynamic> size) {
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
              size['title'],
              style: getBoldTextStyle(
                color: ColorManager.black101828,
                fontSize: FontSizeManager.s14.sp,
              ),
            ),
          ],
        ),
        Gap(AppSize.s12.h),
        _buildOptionsGrid(size['options']),
        Gap(AppSize.s24.h),
      ],
    );
  }

  Widget _buildOptionsGrid(List<dynamic> options) {
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

  Widget _buildMealOptionCard(Map<String, dynamic> option) {
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
            option['title'],
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
                option['price'],
                style: TextStyle(
                  fontFamily: 'Inter',
                  fontWeight: FontWeight.w700,
                  fontSize: FontSizeManager.s18.sp,
                  color: ColorManager
                      .greenPrimary, // Slightly different green on image
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
                option['oldPrice'],
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
