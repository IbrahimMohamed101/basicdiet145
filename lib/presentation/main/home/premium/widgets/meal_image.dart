import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:basic_diet/presentation/widgets/network_image_placeholder.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';

class MealImage extends StatelessWidget {
  final String imageUrl;

  const MealImage({super.key, required this.imageUrl});

  @override
  Widget build(BuildContext context) {
    return NetworkImagePlaceholder(
      imageUrl: imageUrl,
      height: 180.h,
      fit: BoxFit.cover,
      borderRadius: BorderRadius.vertical(top: Radius.circular(AppSize.s16.r)),
    );
  }
}
