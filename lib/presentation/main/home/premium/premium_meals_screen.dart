import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';
import 'package:basic_diet/presentation/main/home/add-ons/add_ons_screen.dart';

class PremiumMealsScreen extends StatefulWidget {
  static const String premiumRoute = '/premium_meals';

  const PremiumMealsScreen({super.key});

  @override
  State<PremiumMealsScreen> createState() => _PremiumMealsScreenState();
}

class _PremiumMealsScreenState extends State<PremiumMealsScreen> {
  // Local state for dummy counters
  final Map<int, int> _mealCounters = {
    1: 1, // ID 1 -> Quantity 1
    2: 1, // ID 2 -> Quantity 1
  };

  void _incrementCounter(int id) {
    setState(() {
      _mealCounters[id] = (_mealCounters[id] ?? 0) + 1;
    });
  }

  void _decrementCounter(int id) {
    setState(() {
      if ((_mealCounters[id] ?? 0) > 0) {
        _mealCounters[id] = (_mealCounters[id] ?? 0) - 1;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF9FAFB),
      appBar: _buildAppBar(context),
      body: SafeArea(
        child: Column(
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
                    _PremiumMealCard(
                      id: 1,
                      title: "Grilled Salmon Steak",
                      description:
                          "Fresh Atlantic salmon, perfectly grilled with herbs and lemon",
                      priceText: "65 SAR",
                      imageUrl:
                          "https://images.unsplash.com/photo-1467003909585-2f8a72700288?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80",
                      quantity: _mealCounters[1] ?? 0,
                      onIncrement: () => _incrementCounter(1),
                      onDecrement: () => _decrementCounter(1),
                    ),
                    Gap(AppSize.s16.h),
                    _PremiumMealCard(
                      id: 2,
                      title: "Jumbo Grilled Shrimp",
                      description:
                          "Large gulf shrimp marinated in garlic butter with fresh herbs",
                      priceText: "65 SAR",
                      imageUrl:
                          "https://images.unsplash.com/photo-1467003909585-2f8a72700288?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80",
                      quantity: _mealCounters[2] ?? 0,
                      onIncrement: () => _incrementCounter(2),
                      onDecrement: () => _decrementCounter(2),
                    ),
                  ],
                ),
              ),
            ),
            const _BottomActions(),
          ],
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
  final int id;
  final String title;
  final String description;
  final String priceText;
  final String imageUrl;
  final int quantity;
  final VoidCallback onIncrement;
  final VoidCallback onDecrement;

  const _PremiumMealCard({
    required this.id,
    required this.title,
    required this.description,
    required this.priceText,
    required this.imageUrl,
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
            child: Image.network(imageUrl, height: 180.h, fit: BoxFit.cover),
          ),
          Padding(
            padding: EdgeInsetsDirectional.all(AppPadding.p16.w),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: getBoldTextStyle(
                    color: ColorManager.black101828,
                    fontSize: FontSizeManager.s16.sp,
                  ).copyWith(height: 24 / 16),
                ),
                Gap(AppSize.s8.h),
                Text(
                  description,
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
                      priceText,
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
