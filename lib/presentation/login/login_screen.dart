import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/widgets/custom_text_field_style.dart';
import 'package:flutter/material.dart';

class LoginScreen extends StatelessWidget {
  static const String loginRoute = "/login";
  const LoginScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: ColorManager.whiteColor,
      body: SafeArea(
        child: Column(
          children: [
            CustomTextFormField(
              hintText: "Email",
              controller: TextEditingController(),
            ),
            CustomTextFormField(
              hintText: "Password",
              controller: TextEditingController(),
            ),
            CustomTextFormField(
              hintText: "Confirm Password",
              controller: TextEditingController(),
            ),
          ],
        ),
      ),
    );
  }
}
