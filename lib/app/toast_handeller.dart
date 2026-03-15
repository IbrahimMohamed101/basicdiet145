import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';

void showToast({required String? message, required ToastStates state}) {
  Fluttertoast.showToast(
    msg: message!,
    toastLength: Toast.LENGTH_SHORT,
    gravity: ToastGravity.BOTTOM,
    timeInSecForIosWeb: 1,
    backgroundColor: getColor(state),
    textColor: Colors.white,
    fontSize: 16.0,
  );
}

enum ToastStates { success, error, warning }

Color getColor(ToastStates toastStates) {
  Color color;
  switch (toastStates) {
    case ToastStates.success:
      color = Colors.green;
      break;
    case ToastStates.error:
      color = Colors.red;
      break;
    case ToastStates.warning:
      color = Colors.amberAccent;
      break;
  }
  return color;
}
