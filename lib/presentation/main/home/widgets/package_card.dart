import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:basic_diet/domain/model/popular_packages_model.dart';
import 'package:basic_diet/presentation/resources/assets_manager.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:gap/gap.dart';

class PackageCard extends StatelessWidget {
  const PackageCard({super.key, required this.package});

  final PopularPackageModel package;

  String _formatAmount(num value) {
    final formattedValue = value.toStringAsFixed(2);
    return formattedValue.replaceFirst(RegExp(r'\.?0+$'), '');
  }

  // Formatting helpers — keep presentation logic out of build()
  String get _mealsDesc =>
      '${package.mealsPerDay} ${Strings.mealsPerDay.tr()} - ${package.daysCount} ${Strings.days.tr()}';
  String get _price => '${_formatAmount(package.newPrice)} ${Strings.sar.tr()}';
  String get _originalPrice =>
      '${_formatAmount(package.oldPrice)} ${Strings.sar.tr()}';
  String get _saveAmount =>
      '${Strings.save.tr()} ${_formatAmount(package.moneySave)} ${Strings.sar.tr()}';

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsetsDirectional.all(AppPadding.p16.w),
      decoration: BoxDecoration(
        color: ColorManager.backgroundSurface,
        borderRadius: BorderRadius.circular(AppSize.s16.r),
        border: Border.all(
          color: ColorManager.borderDefault,
          width: AppSize.s1,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _PackageCardHeader(
            title: package.name,
            tagText: Strings.mostPopular.tr(),
          ),
          Gap(AppSize.s8.h),
          Text(
            _mealsDesc,
            style: getRegularTextStyle(
              fontSize: FontSizeManager.s12.sp,
              color: ColorManager.textSecondary,
            ).copyWith(height: 16 / 12),
          ),
          Gap(AppSize.s16.h),
          _PackageCardFooter(
            price: _price,
            originalPrice: _originalPrice,
            saveAmount: _saveAmount,
          ),
        ],
      ),
    );
  }
}

class _PackageCardHeader extends StatelessWidget {
  const _PackageCardHeader({required this.title, required this.tagText});

  final String title;
  final String tagText;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Row(
          children: [
            Text(
              title,
              style: getBoldTextStyle(
                fontSize: FontSizeManager.s16.sp,
                color: ColorManager.textPrimary,
              ).copyWith(height: 24 / 16),
            ),
            Gap(AppSize.s8.w),
            _TagBadge(label: tagText),
          ],
        ),
        SvgPicture.asset(
          IconAssets.star,
          width: AppSize.s24.w,
          height: AppSize.s24.h,
        ),
      ],
    );
  }
}

class _TagBadge extends StatelessWidget {
  const _TagBadge({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsetsDirectional.symmetric(
        horizontal: AppPadding.p8.w,
        vertical: AppSize.s4.h,
      ),
      decoration: BoxDecoration(
        color: ColorManager.brandAccent,
        borderRadius: BorderRadius.circular(AppSize.s8.r),
      ),
      child: Text(
        label,
        style: getBoldTextStyle(
          fontSize: 9.sp,
          color: ColorManager.textInverse,
        ).copyWith(height: 13.5 / 9),
      ),
    );
  }
}

class _PackageCardFooter extends StatelessWidget {
  const _PackageCardFooter({
    required this.price,
    required this.originalPrice,
    required this.saveAmount,
  });

  final String price;
  final String originalPrice;
  final String saveAmount;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(
              price,
              style: getBoldTextStyle(
                fontSize: FontSizeManager.s20.sp,
                color: ColorManager.brandPrimary,
              ).copyWith(height: 28 / 20),
            ),
            Gap(AppSize.s8.w),
            Padding(
              padding: EdgeInsetsDirectional.only(bottom: AppSize.s2.h),
              child: Text(
                originalPrice,
                style: getRegularTextStyle(
                  fontSize: FontSizeManager.s14.sp,
                  color: ColorManager.textSecondary.withValues(alpha: 0.6),
                ).copyWith(decoration: TextDecoration.lineThrough),
              ),
            ),
          ],
        ),
        _SaveBadge(label: saveAmount),
      ],
    );
  }
}

class _SaveBadge extends StatelessWidget {
  const _SaveBadge({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsetsDirectional.symmetric(
        horizontal: AppPadding.p12.w,
        vertical: AppPadding.p8.h,
      ),
      decoration: BoxDecoration(
        color: ColorManager.brandPrimaryTint,
        borderRadius: BorderRadius.circular(AppSize.s16.r),
      ),
      child: Text(
        label,
        style: getBoldTextStyle(
          fontSize: FontSizeManager.s12.sp,
          color: ColorManager.brandPrimary,
        ),
      ),
    );
  }
}
