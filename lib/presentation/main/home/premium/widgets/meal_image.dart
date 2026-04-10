import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';

class MealImage extends StatelessWidget {
  final String imageUrl;

  const MealImage({super.key, required this.imageUrl});

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.vertical(top: Radius.circular(AppSize.s16.r)),
      child: Image.network(
        imageUrl,
        height: 180.h,
        fit: BoxFit.cover,
        errorBuilder: (_, __, ___) => Container(
          height: 180.h,
          color: ColorManager.greyF3F4F6,
          child: Center(
            child: Icon(
              Icons.image_not_supported,
              color: ColorManager.grey6A7282,
            ),
          ),
        ),
      ),
    );
  }
}
