import 'package:easy_localization/easy_localization.dart';
import 'package:basic_diet/app/functions.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: ColorManager.whiteColor,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(AppPadding.p20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                Strings.language.tr(),
                style: getBoldTextStyle(
                  color: ColorManager.black101828,
                  fontSize: FontSizeManager.s18,
                ),
              ),
              const SizedBox(height: AppSize.s18),
              InkWell(
                onTap: () => changeLanguage(context),
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppPadding.p18,
                    vertical: AppPadding.p24,
                  ),
                  decoration: BoxDecoration(
                    color: ColorManager.greyF3F4F6.withOpacity(0.5),
                    borderRadius: BorderRadius.circular(AppSize.s24),
                  ),
                  child: Row(
                    children: [
                      Text(
                        Strings.english.tr(),
                        style: getRegularTextStyle(
                          color: ColorManager.grey6A7282,
                          fontSize: FontSizeManager.s18,
                        ),
                      ),
                      const Spacer(),
                      const Icon(
                        Icons.arrow_forward_ios_rounded,
                        color: ColorManager.grey9CA3AF,
                        size: AppSize.s16,
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
