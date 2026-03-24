import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';

class AddOnsScreen extends StatefulWidget {
  static const String addOnsRoute = '/add_ons';

  const AddOnsScreen({super.key});

  @override
  State<AddOnsScreen> createState() => _AddOnsScreenState();
}

class _AddOnsScreenState extends State<AddOnsScreen> {
  // To keep track of selected add-ons by ID
  final Set<int> _selectedIds = {};

  void _toggleSelection(int id) {
    setState(() {
      if (_selectedIds.contains(id)) {
        _selectedIds.remove(id);
      } else {
        _selectedIds.add(id);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: ColorManager.whiteColor,
      appBar: _buildAppBar(context),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: SingleChildScrollView(
                padding: EdgeInsetsDirectional.symmetric(
                  horizontal: AppPadding.p20.w,
                  vertical: AppPadding.p20.h,
                ),
                child: Column(
                  children: [
                    Text(
                      Strings.enhanceYourPlan,
                      style: getBoldTextStyle(
                        color: ColorManager.black101828,
                        fontSize: FontSizeManager.s18.sp,
                      ),
                    ),
                    Gap(AppSize.s8.h),
                    Text(
                      Strings.addExtraItemsOptional,
                      textAlign: TextAlign.center,
                      style: getRegularTextStyle(
                        color: ColorManager.grey6A7282,
                        fontSize: FontSizeManager.s14.sp,
                      ),
                    ),
                    Gap(AppSize.s30.h),
                    _AddOnCard(
                      id: 1,
                      title: Strings.dailySnacks,
                      subtitle: Strings.healthySnacksToKeep,
                      priceText: Strings.plus29SAR,
                      imageUrl:
                          "https://images.unsplash.com/photo-1599599810769-bcde5a160d32?ixlib=rb-4.0.3&auto=format&fit=crop&w=300&q=80",
                      isSelected: _selectedIds.contains(1),
                      onTap: () => _toggleSelection(1),
                    ),
                    Gap(AppSize.s16.h),
                    _AddOnCard(
                      id: 2,
                      title: Strings.freshJuicePack,
                      subtitle: Strings.dailyFreshPressedJuices,
                      priceText: Strings.plus39SAR,
                      imageUrl:
                          "https://images.unsplash.com/photo-1599599810769-bcde5a160d32?ixlib=rb-4.0.3&auto=format&fit=crop&w=300&q=80",
                      isSelected: _selectedIds.contains(2),
                      onTap: () => _toggleSelection(2),
                    ),
                    Gap(AppSize.s16.h),
                    _AddOnCard(
                      id: 3,
                      title: Strings.extraSalad,
                      subtitle: Strings.addExtraSaladToPlan,
                      priceText: Strings.plus19SAR,
                      imageUrl:
                          "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?ixlib=rb-4.0.3&auto=format&fit=crop&w=300&q=80",
                      isSelected: _selectedIds.contains(3),
                      onTap: () => _toggleSelection(3),
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
      leading: IconButton(
        onPressed: () => Navigator.pop(context),
        icon: Icon(
          Icons.arrow_back_ios_new,
          color: ColorManager.blackColor,
          size: AppSize.s20.sp,
        ),
      ),
      title: Text(
        Strings.addOns,
        style: getBoldTextStyle(
          color: ColorManager.black101828,
          fontSize: FontSizeManager.s18.sp,
        ),
      ),
      bottom: PreferredSize(
        preferredSize: Size.fromHeight(1.0),
        child: Container(
          color: ColorManager.formFieldsBorderColor,
          height: 1.0,
        ),
      ),
    );
  }
}

class _AddOnCard extends StatelessWidget {
  final int id;
  final String title;
  final String subtitle;
  final String priceText;
  final String imageUrl;
  final bool isSelected;
  final VoidCallback onTap;

  const _AddOnCard({
    required this.id,
    required this.title,
    required this.subtitle,
    required this.priceText,
    required this.imageUrl,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: EdgeInsetsDirectional.all(AppPadding.p16.w),
        decoration: BoxDecoration(
          color: ColorManager.whiteColor,
          borderRadius: BorderRadius.circular(AppSize.s16.r),
          border: Border.all(
            color: isSelected
                ? ColorManager.greenPrimary
                : ColorManager.formFieldsBorderColor,
            width: isSelected ? 2 : 1,
          ),
          boxShadow: [
            if (isSelected)
              BoxShadow(
                color: ColorManager.greenPrimary.withOpacity(0.1),
                blurRadius: 10,
                offset: const Offset(0, 4),
              )
            else
              BoxShadow(
                color: Colors.black.withOpacity(0.02),
                blurRadius: 8,
                offset: const Offset(0, 2),
              ),
          ],
        ),
        child: Row(
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(AppSize.s12.r),
              child: Image.network(
                imageUrl,
                width: 70.w,
                height: 70.w,
                fit: BoxFit.cover,
              ),
            ),
            Gap(AppSize.s16.w),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: getBoldTextStyle(
                      color: ColorManager.black101828,
                      fontSize: FontSizeManager.s16.sp,
                    ),
                  ),
                  Gap(AppSize.s4.h),
                  Text(
                    subtitle,
                    style: getRegularTextStyle(
                      color: ColorManager.grey6A7282,
                      fontSize: FontSizeManager.s14.sp,
                    ),
                  ),
                  Gap(AppSize.s5.h),
                  Text(
                    priceText,
                    style: getBoldTextStyle(
                      color: ColorManager.black101828,
                      fontSize: FontSizeManager.s14.sp,
                    ),
                  ),
                ],
              ),
            ),
            Gap(AppSize.s8.w),
            _SelectionIndicator(isSelected: isSelected),
          ],
        ),
      ),
    );
  }
}

class _SelectionIndicator extends StatelessWidget {
  final bool isSelected;

  const _SelectionIndicator({required this.isSelected});

  @override
  Widget build(BuildContext context) {
    if (isSelected) {
      return Container(
        width: AppSize.s24.w,
        height: AppSize.s24.w,
        decoration: BoxDecoration(
          color: ColorManager.greenPrimary.withOpacity(0.1),
          shape: BoxShape.circle,
        ),
        child: Icon(
          Icons.circle,
          color: ColorManager.greenPrimary,
          size: AppSize.s14.sp,
        ),
      );
    } else {
      return Container(
        width: AppSize.s24.w,
        height: AppSize.s24.w,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          border: Border.all(
            color: ColorManager.formFieldsBorderColor,
            width: 2,
          ),
        ),
      );
    }
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
      color: ColorManager.whiteColor,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ElevatedButton(
            onPressed: () {
              // TODO: Continue action
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
              // TODO: Skip action
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
