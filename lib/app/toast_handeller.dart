import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';

void showToast({required String? message, required ToastStates state}) {
  Fluttertoast.showToast(
    msg: message!,
    toastLength: Toast.LENGTH_SHORT,
    gravity: ToastGravity.BOTTOM,
    timeInSecForIosWeb: 1,
    backgroundColor: getColor(state),
    textColor: ColorManager.textInverse,
    fontSize: 16.0,
  );
}

enum ToastStates { success, error, warning }

Color getColor(ToastStates toastStates) {
  Color color;
  switch (toastStates) {
    case ToastStates.success:
      color = ColorManager.stateSuccess;
      break;
    case ToastStates.error:
      color = ColorManager.stateError;
      break;
    case ToastStates.warning:
      color = ColorManager.stateWarning;
      break;
  }
  return color;
}
