import 'package:basic_diet/presentation/resources/assets_manager.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';

class SubscriptionPoliciesDialog extends StatefulWidget {
  const SubscriptionPoliciesDialog({super.key});

  static Future<bool> show(BuildContext context) async {
    final result = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (_) => const SubscriptionPoliciesDialog(),
    );
    return result ?? false;
  }

  @override
  State<SubscriptionPoliciesDialog> createState() =>
      _SubscriptionPoliciesDialogState();
}

class _SubscriptionPoliciesDialogState extends State<SubscriptionPoliciesDialog> {
  bool _isAgreed = false;

  @override
  Widget build(BuildContext context) {
    final maxContentHeight = MediaQuery.sizeOf(context).height * 0.52;

    return AlertDialog(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppSize.s16.r),
      ),
      titlePadding: EdgeInsets.fromLTRB(
        AppPadding.p20.w,
        AppPadding.p20.h,
        AppPadding.p20.w,
        AppPadding.p12.h,
      ),
      contentPadding: EdgeInsets.fromLTRB(
        AppPadding.p20.w,
        0,
        AppPadding.p20.w,
        AppPadding.p8.h,
      ),
      actionsPadding: EdgeInsets.fromLTRB(
        AppPadding.p20.w,
        0,
        AppPadding.p20.w,
        AppPadding.p20.h,
      ),
      title: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Center(
            child: Container(
              width: AppSize.s55.w,
              height: AppSize.s55.w,
              padding: EdgeInsets.all(AppPadding.p10.r),
              decoration: BoxDecoration(
                color: ColorManager.greyF3F4F6,
                shape: BoxShape.circle,
                border: Border.all(
                  color: ColorManager.formFieldsBorderColor,
                  width: AppSize.s1,
                ),
              ),
              child: Image.asset(ImageAssets.splashLogo, fit: BoxFit.contain),
            ),
          ),
          Gap(AppSize.s12.h),
          Text(
            Strings.subscriptionPoliciesTitle.tr(),
            textAlign: TextAlign.center,
            style: getBoldTextStyle(
              color: ColorManager.black101828,
              fontSize: FontSizeManager.s16.sp,
            ),
          ),
          Gap(AppSize.s6.h),
          Text(
            Strings.subscriptionPoliciesSubtitle.tr(),
            textAlign: TextAlign.center,
            style: getRegularTextStyle(
              color: ColorManager.grey6A7282,
              fontSize: FontSizeManager.s12.sp,
            ),
          ),
        ],
      ),
      content: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: maxContentHeight),
        child: Column(
          children: [
            const Divider(height: 1, color: ColorManager.formFieldsBorderColor),
            Gap(AppSize.s12.h),
            Expanded(
              child: Scrollbar(
                child: SingleChildScrollView(
                  child: SelectableText(
                    Strings.subscriptionPoliciesBody.tr(),
                    textAlign: TextAlign.start,
                    style: getRegularTextStyle(
                      color: ColorManager.blackColor,
                      fontSize: FontSizeManager.s12.sp,
                    ),
                  ),
                ),
              ),
            ),
            Gap(AppSize.s12.h),
            CheckboxListTile(
              value: _isAgreed,
              onChanged: (value) =>
                  setState(() => _isAgreed = value ?? false),
              dense: true,
              activeColor: ColorManager.greenPrimary,
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
              title: Text(
                Strings.subscriptionPoliciesAgreement.tr(),
                style: getRegularTextStyle(
                  color: ColorManager.black101828,
                  fontSize: FontSizeManager.s12.sp,
                ),
              ),
            ),
          ],
        ),
      ),
      actions: [
        Row(
          children: [
            Expanded(
              child: OutlinedButton(
                onPressed: () => Navigator.of(context).pop(false),
                style: OutlinedButton.styleFrom(
                  padding: EdgeInsets.symmetric(vertical: AppPadding.p12.h),
                  side: const BorderSide(
                    color: ColorManager.formFieldsBorderColor,
                  ),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(AppSize.s10.r),
                  ),
                ),
                child: Text(
                  Strings.cancel.tr(),
                  style: getRegularTextStyle(
                    color: ColorManager.black101828,
                    fontSize: FontSizeManager.s14.sp,
                  ),
                ),
              ),
            ),
            Gap(AppSize.s10.w),
            Expanded(
              child: ElevatedButton(
                onPressed: _isAgreed
                    ? () => Navigator.of(context).pop(true)
                    : null,
                style: ElevatedButton.styleFrom(
                  backgroundColor: ColorManager.greenPrimary,
                  disabledBackgroundColor:
                      ColorManager.greenPrimary.withValues(alpha: 0.35),
                  padding: EdgeInsets.symmetric(vertical: AppPadding.p12.h),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(AppSize.s10.r),
                  ),
                ),
                child: Text(
                  Strings.subscriptionPoliciesAgreeContinue.tr(),
                  textAlign: TextAlign.center,
                  style: getRegularTextStyle(
                    color: ColorManager.whiteColor,
                    fontSize: FontSizeManager.s14.sp,
                  ),
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }
}
