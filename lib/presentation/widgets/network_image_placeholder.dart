import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';

/// A [Image.network] wrapper that gracefully handles empty / invalid URLs
/// and image-load failures by showing a neutral placeholder.
class NetworkImagePlaceholder extends StatelessWidget {
  final String? imageUrl;
  final double? width;
  final double? height;
  final BoxFit fit;
  final BorderRadius? borderRadius;

  const NetworkImagePlaceholder({
    super.key,
    required this.imageUrl,
    this.width,
    this.height,
    this.fit = BoxFit.cover,
    this.borderRadius,
  });

  bool get _isValidUrl {
    if (imageUrl == null || imageUrl!.trim().isEmpty) return false;
    final uri = Uri.tryParse(imageUrl!);
    return uri != null && uri.hasScheme && uri.host.isNotEmpty;
  }

  @override
  Widget build(BuildContext context) {
    final placeholder = _Placeholder(width: width, height: height);

    if (!_isValidUrl) return placeholder;

    Widget image = Image.network(
      imageUrl!,
      width: width,
      height: height,
      fit: fit,
      errorBuilder: (_, __, ___) => placeholder,
      loadingBuilder: (_, child, loadingProgress) {
        if (loadingProgress == null) return child;
        return _Placeholder(width: width, height: height);
      },
    );

    if (borderRadius != null) {
      image = ClipRRect(borderRadius: borderRadius!, child: image);
    }

    return image;
  }
}

class _Placeholder extends StatelessWidget {
  final double? width;
  final double? height;

  const _Placeholder({this.width, this.height});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: height,
      color: ColorManager.greyF3F4F6,
      child: Center(
        child: Icon(
          Icons.image_not_supported_outlined,
          color: ColorManager.grey9CA3AF,
          size: 24.w,
        ),
      ),
    );
  }
}
