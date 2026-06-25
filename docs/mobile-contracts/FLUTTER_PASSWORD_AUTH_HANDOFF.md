# Flutter Technical Handoff: Password-Based Customer Authentication

## 1. Executive Summary & Architectural Alignment

* **Contract Status**: `BACKEND_READY_FLUTTER_PENDING`
* **Objective**: Technical handoff for the Flutter mobile application (`mobile_app`) transition from legacy OTP-based customer authentication to a secure, password-based authentication system (`Phone + Password`).
* **Scope**: Comprehensive frontend implementation guide designed for Flutter developers (and suitable for direct ingestion into AI coding assistants like Codex). This document outlines necessary Flutter modifications; no backend or dashboard code changes are required.
* **Architectural Tenets**:
  * **OTP Role & Compatibility**: OTP is no longer the primary authentication flow. While `AUTH_OTP_ENABLED=false` prevents SMS/OTP generation in the new authentication paths, the legacy OTP and app endpoints remain active on the backend to ensure backward compatibility. The Flutter application must completely bypass and discontinue the use of OTP in the primary `register`, `login`, and `forgot password` flows.
  * **Password Authentication**: Primary authentication is governed by `AUTH_PASSWORD_LOGIN_ENABLED=true`.
  * **Backend Source of Truth**: The backend remains the canonical authority for error validation, token lifecycle management, and security boundary state flags (such as `forcePasswordChange`).
  * **Clean Architecture & Bloc Pattern**: All updates must strictly adhere to the existing directory structure, data mappers, repository contracts, and Bloc state management patterns established in `/home/hema/Projects/full app/mobile_app`.

> [!CAUTION]
> **Sensitive Data Handling & Storage**: Do NOT store `currentPassword`, `newPassword`, or `confirmPassword` in `AppPreferences`, secure storage, application logs, analytics events, crash reports, or long-lived Bloc state. All password input fields must use `obscureText: true`, and `TextEditingController` instances must be explicitly cleared (`controller.clear()`) and disposed of as soon as practical.

---

## 2. Backend API Contract & Payload Specifications

This section provides the definitive backend contracts for password authentication, including verified endpoints, HTTP methods, headers, payload structures, and response schemas.

### 2.1 Customer Registration (`POST /api/auth/register`)
* **Endpoint**: `POST /api/auth/register`
* **Headers**: 
  * `Content-Type: application/json`
  * `Accept-Language: ar`
* **Request Payload**:
  ```json
  {
    "phone": "+966501234567",
    "password": "Password123",
    "confirmPassword": "Password123",
    "email": "optional@example.com"
  }
  ```
  *(Note: `email` is optional. `confirmPassword` is required by the backend DTO validation and must match `password`).*
* **Success Response (201 Created)**:
  ```json
  {
    "ok": true,
    "status": "registered",
    "accessToken": "eyJhbGciOi...",
    "refreshToken": "eyJhbGciOi...",
    "expiresIn": 900,
    "refreshExpiresIn": 2592000,
    "user": {
      "id": "60d5ecb74d6bb830d456d123",
      "phoneE164": "+966501234567",
      "phoneVerified": true,
      "email": "optional@example.com",
      "forcePasswordChange": false
    }
  }
  ```
  *(Note: Password hashes are never returned or leaked in responses).*
* **Failure Responses**:
  * `400 Bad Request`: Missing `phone`, missing `password`, or password mismatch between `password` and `confirmPassword`.
  * `409 Conflict`: Duplicate phone number or email already registered in the system.

### 2.2 Customer Login (`POST /api/auth/login`)
* **Endpoint**: `POST /api/auth/login`
* **Headers**: 
  * `Content-Type: application/json`
  * `Accept-Language: ar`
* **Request Payload**:
  ```json
  {
    "phone": "+966501234567",
    "password": "Password123"
  }
  ```
* **Success Response (200 OK)**:
  ```json
  {
    "ok": true,
    "status": "logged_in",
    "accessToken": "eyJhbGciOi...",
    "refreshToken": "eyJhbGciOi...",
    "expiresIn": 900,
    "refreshExpiresIn": 2592000,
    "user": {
      "id": "60d5ecb74d6bb830d456d123",
      "phoneE164": "+966501234567",
      "phoneVerified": true,
      "forcePasswordChange": false
    }
  }
  ```
  *CRITICAL INTERCEPTION RULE*: If `user.forcePasswordChange` is `true`, the mobile application MUST intercept the standard navigation flow. Instead of routing the user to `MainScreen.mainRoute`, the app must immediately redirect the user to `ChangePasswordScreen` using `context.go` to prevent backward navigation.
* **Failure Responses**:
  * `401 Unauthorized`: Wrong password or unknown phone number. To prevent user enumeration attacks, the backend returns an identical, generic error structure for both cases:
    ```json
    {
      "error": {
        "code": "INVALID_CREDENTIALS",
        "message": "Invalid phone or password"
      }
    }
    ```

### 2.3 Customer Change Password (`POST /api/auth/change-password`)
* **Endpoint**: `POST /api/auth/change-password`
* **Headers**: 
  * `Content-Type: application/json`
  * `Authorization: Bearer <accessToken>`
  * `Accept-Language: ar`
* **Request Payload**:
  ```json
  {
    "currentPassword": "Temporary123",
    "newPassword": "NewPassword123",
    "confirmPassword": "NewPassword123"
  }
  ```
* **Success Response (200 OK)**:
  ```json
  {
    "status": true,
    "message": "Password changed successfully"
  }
  ```
  *(Note: A successful password change automatically clears the `forcePasswordChange` flag on the backend user document).*

### 2.4 Administrative Password Reset (`POST /api/dashboard/users/:id/reset-password`)
* **Context & Security Boundaries**: When a customer forgets their password, an authorized administrator (`admin` or `superadmin`) initiates a password reset via the administrative dashboard. The `cashier` role is strictly barred from performing this action (`403 Forbidden`).
* **Backend Lifecycle**: The dashboard reset operation assigns a temporary password to the customer, sets `forcePasswordChange: true` in the database, and records an `ActivityLog` entry (`customer_password_reset_by_admin`). When the customer logs into the Flutter app using this temporary password, the app detects `forcePasswordChange: true` in the login response and forces the user to set a new password before granting access to the application.

---

### 2.5 Comprehensive Error Code Mapping

The Flutter data layer (`ExceptionHandler` / `ErrorMapper`) must implement comprehensive mapping for all backend error codes to ensure robust handling and correct user presentation.

| Backend Error Code | HTTP Status | Context / Cause | Required Flutter Behavior / UI Action |
| :--- | :--- | :--- | :--- |
| `VALIDATION_ERROR` | `400 Bad Request` | Malformed request body, missing mandatory fields, or DTO validation failure. | Highlight offending UI input fields; display localized error prompt. |
| `PHONE_IN_USE` | `409 Conflict` | The phone number provided during registration is already linked to an existing account. | Alert user that the phone is registered; offer navigation to Login screen. |
| `EMAIL_IN_USE` | `409 Conflict` | The optional email provided during registration is already registered. | Prompt user to use a different email or log in. |
| `INVALID_CREDENTIALS` | `401 Unauthorized` | Incorrect phone number or password during login. | Display generic Arabic error: `"رقم الجوال أو كلمة المرور غير صحيحة"`. |
| `PASSWORD_RESET_REQUIRED` | `403 Forbidden` / `401` | An administrative reset occurred, or the account requires a mandatory password update. | Intercept routing; immediately redirect to `ChangePasswordScreen` using `context.go`. |
| `OTP_DISABLED` | `403 Forbidden` | Attempted to request or verify OTP while `AUTH_OTP_ENABLED=false`. | Log error; ensure UI strictly uses the password-based primary flow. |
| `TOKEN_EXPIRED` | `401 Unauthorized` | The short-lived JWT access token has expired. | Transparently invoke `refreshToken` endpoint; retry original request. |
| `TOKEN_INVALID` | `401 Unauthorized` | The access token is malformed, tampered with, or invalid. | Purge session tokens (`AppPreferences.clearSession`); redirect to Login. |
| `REFRESH_TOKEN_INVALID`| `401 Unauthorized` | The refresh token is expired, unrecognized, or invalid. | Purge session tokens; redirect to Login screen immediately. |
| `SESSION_REVOKED` | `401 Unauthorized` | The user session was actively revoked or logged out from the backend. | Clear session state; display expiration prompt and redirect to Login. |
| `FORBIDDEN` | `403 Forbidden` | Insufficient role permissions (e.g., cashier attempting admin actions). | Display access denied prompt; restrict unauthorized UI actions. |
| `SERVER_ERROR` | `500 Internal Server`| Unhandled backend exception or database connectivity failure. | Display generic polite failure message; offer retry mechanism. |

---

## 3. Flutter Architecture & Codebase Mapping

This section maps the backend contracts directly to the existing Flutter codebase (`/home/hema/Projects/full app/mobile_app`). Flutter developers can use these specifications to guide implementation or as a direct prompt for Codex/AI coding assistants.

```
lib/
├── app/
│   ├── app_pref.dart                 # Session token & expiry storage
│   ├── auth_gate.dart                # Authentication gatekeeper & startup rules
│   └── dependency_injection.dart     # Service & Bloc registration
├── data/
│   ├── data_source/
│   │   └── remote_data_source.dart   # Remote API binding contracts
│   ├── mappers/
│   │   └── auth_mapper.dart          # DTO to Domain model mapping
│   ├── network/
│   │   └── app_api.dart              # Retrofit/Dio client definition
│   ├── repository/
│   │   └── repository.dart           # RepositoryImpl implementation
│   └── response/
│   │   └── auth_response.dart        # JSON Serializable DTOs
├── domain/
│   ├── model/
│   │   └── auth_model.dart           # Clean Architecture domain models
│   ├── repository/
│   │   └── repository.dart           # Domain repository interface
│   └── usecase/
│       ├── login_usecase.dart        # Login business logic
│       ├── register_usecase.dart     # [NEW] Direct password registration
│       └── change_password_usecase.dart # [NEW] Mandatory password update
└── presentation/
    ├── login/                        # Login UI & Bloc (Interception logic)
    ├── register/                     # Register UI & Bloc (Separate password fields)
    ├── change_password/              # [NEW] Force password change screen & Bloc
    └── resources/
        ├── routes_manager.dart       # GoRouter configuration
        └── strings_manager.dart      # Arabic UI copy definitions
```

### 3.1 Data Layer

#### `lib/data/response/auth_response.dart`
* **Current State**: Defines `AuthenticationResponse` and `AuthUserResponse`.
* **Action Required**: Add the `forcePasswordChange` boolean field to `AuthUserResponse` to capture the flag from the login response.
  ```dart
  @JsonSerializable()
  class AuthUserResponse {
    @JsonKey(name: "id")
    final String? id;
    @JsonKey(name: "phoneE164")
    final String? phoneE164;
    @JsonKey(name: "phoneVerified")
    final bool? phoneVerified;
    @JsonKey(name: "forcePasswordChange")
    final bool? forcePasswordChange; // ADDED

    const AuthUserResponse({
      this.id, 
      this.phoneE164, 
      this.phoneVerified, 
      this.forcePasswordChange,
    });

    factory AuthUserResponse.fromJson(Map<String, dynamic> json) =>
        _$AuthUserResponseFromJson(json);

    Map<String, dynamic> toJson() => _$AuthUserResponseToJson(this);
  }
  ```
* **Build Runner**: Execute `flutter pub run build_runner build --delete-conflicting-outputs` to regenerate `auth_response.g.dart`.

#### `lib/data/network/app_api.dart`
* **Current State**: `AppServiceClient` defines legacy auth endpoints (`login`, `requestRegistrationOtp`, `verifyRegistrationOtp`, `requestPasswordResetOtp`, `resetPassword`).
* **Action Required**:
  1. Add `@POST("/api/auth/register")` for direct password registration.
     ```dart
     @POST("/api/auth/register")
     Future<AuthenticationResponse> register(@Body() Map<String, dynamic> body);
     ```
  2. Add `@POST("/api/auth/change-password")` for password updates.
     ```dart
     @POST("/api/auth/change-password")
     Future<BaseResponse> changePassword(@Body() Map<String, dynamic> body);
     ```
  3. Keep legacy OTP endpoints in the Retrofit interface to maintain backward compatibility for potential backend rollbacks, but discontinue their invocation in the UI layer.

> [!IMPORTANT]
> **Retrofit Path Convention**: Use the same endpoint style currently used in `app_api.dart`. If `baseUrl` already includes `/api`, do not duplicate `/api` in `@POST` paths (e.g., use `@POST("/auth/register")` if existing paths omit `/api`, or `@POST("/api/auth/register")` if existing paths include it). Always match the existing codebase pattern perfectly.

#### `lib/data/mappers/auth_mapper.dart`
* **Action Required**: Update `AuthUserResponse.toDomain()` to ensure `forcePasswordChange` is correctly mapped to the domain model with a safe fallback:
  ```dart
  forcePasswordChange: forcePasswordChange ?? false,
  ```

#### `lib/data/repository/repository.dart` (`RepositoryImpl`)
* **Action Required**: Implement `register` and `changePassword` methods in `RepositoryImpl`. Ensure all Dio errors are caught and transformed into domain `Failure` objects using the established `_handleError` utility.

---

### 3.2 Domain Layer

#### `lib/domain/model/auth_model.dart`
* **Action Required**: Extend `AuthUserModel` to include `bool forcePasswordChange`.

#### `lib/domain/repository/repository.dart`
* **Action Required**: Add the new method signatures to the `Repository` abstract class:
  ```dart
  Future<Either<Failure, AuthenticationModel>> register(
    String phone, 
    String password, 
    String confirmPassword, {
    String? email,
  });
  
  Future<Either<Failure, BaseModel>> changePassword(
    String currentPassword, 
    String newPassword, 
    String confirmPassword,
  );
  ```

#### `lib/domain/usecase/`
* **Action Required**: 
  * Create `RegisterUseCase` accepting `phone`, `password`, `confirmPassword`, and optional `email`.
  * Create `ChangePasswordUseCase` accepting `currentPassword`, `newPassword`, and `confirmPassword`.
  * Verify `LoginUseCase` propagates `AuthenticationModel` containing the `forcePasswordChange` flag to the presentation layer.

---

### 3.3 Presentation Layer & State Management (Bloc)

> [!CAUTION]
> **Security Mandatory Rule**: Do NOT store `currentPassword`, `newPassword`, or `confirmPassword` in `AppPreferences`, secure storage, application logs, analytics events, crash reports, or long-lived Bloc state. All password input fields must use `obscureText: true`, and `TextEditingController` instances must be explicitly cleared (`controller.clear()`) and disposed of as soon as practical.

#### `lib/presentation/register/` (`register_bloc.dart` & `register_screen.dart`)
* **Mandatory UI Requirement**: `RegisterScreen` MUST provide two separate, distinct UI input fields for `password` and `confirmPassword`. Do NOT automatically set `confirmPassword = password`.
* **New Flow**:
  * `RegisterScreen` captures `phone`, `password`, and `confirmPassword` from the user.
  * `RegisterBloc` validates that `password == confirmPassword` before submission.
  * `RegisterBloc` executes `RegisterUseCase`. Upon receiving a success `Either.Right`, `RegisterBloc` calls `AppPreferences.saveSession` to persist `accessToken` and `refreshToken`.
  * `RegisterBloc` emits `RegisterSuccessState`.
  * In `RegisterScreen`, the `BlocListener` intercepts `RegisterSuccessState` and executes `context.go(MainScreen.mainRoute)`.
  * `VerifyScreen` (OTP verification) is completely bypassed.

#### `lib/presentation/login/` (`login_bloc.dart` & `login_screen.dart`)
* **Legacy Flow**: Called `LoginUseCase`, persisted tokens, and navigated directly to `MainScreen.mainRoute`.
* **New Interception Flow**:
  * `LoginBloc` calls `LoginUseCase`. Upon receiving `Either.Right(authenticationModel)`, `LoginBloc` calls `AppPreferences.saveSession`.
  * `LoginBloc` evaluates `authenticationModel.user.forcePasswordChange`.
  * If `forcePasswordChange == true`, `LoginBloc` emits `LoginForcePasswordChangeRequiredState(phone: phone)`.
  * If `forcePasswordChange == false`, `LoginBloc` emits `LoginSuccessState`.
  * **SECURITY MANDATORY RULE**: It is strictly forbidden to pass the temporary or current password inside `route extras` or navigation arguments.
  * **NAVIGATION RULE**: Use `context.go` instead of `context.push` for the force password change transition to prevent the user from navigating backward to the login screen or dismissing the forced flow.
  * In `LoginScreen`, the `BlocListener` handles the branch without passing sensitive credentials:
    ```dart
    if (state is LoginSuccessState) {
      context.go(MainScreen.mainRoute);
    } else if (state is LoginForcePasswordChangeRequiredState) {
      context.go(
        ChangePasswordScreen.routeName, 
        extra: state.phone, // Passing phone only; NO passwords in route extras
      );
    }
    ```

#### `lib/presentation/change_password/` (New Feature Module)
* **Action Required**: Create a dedicated `ChangePasswordScreen` and `ChangePasswordBloc` adhering to the app's established design language (`AppTextField.password`, `ButtonWidget`, `ColorManager.backgroundSurface`).
* **Behavior & Security Enforcement**: 
  * The screen must explicitly prompt the user to enter `currentPassword` (their temporary password) in a dedicated input field, alongside `newPassword` and `confirmPassword`. Alternatively, an ephemeral in-memory state (unpersisted and not passed via navigation) may be utilized if managed within a unified authentication flow.
  * On submission, `ChangePasswordBloc` validates `newPassword == confirmPassword` and dispatches `ChangePasswordUseCase`.
  * On success, displays a success `SnackBar` (`"تم تغيير كلمة المرور بنجاح"`) and navigates to `MainScreen.mainRoute`.
  * Ensure controllers are explicitly cleared (`_currentPasswordController.clear()`, `_newPasswordController.clear()`, `_confirmPasswordController.clear()`) after submission.

#### `lib/presentation/forgot_password/forgot_password_screen.dart`
* **Support-Only Enforcement (Phase 1)**: The Forgot Password flow in Phase 1 is strictly **support-only**. There is NO OTP password reset, NO email password reset, and NO self-service reset mechanism.
* **Action Required**: Update `ForgotPasswordScreen` to remove all OTP request input fields and submit buttons. Replace them with clear, elegant static text directing the customer to contact customer support or a system administrator to request an administrative password reset.

#### `lib/presentation/resources/routes_manager.dart`
* **Action Required**: Register `ChangePasswordScreen.routeName` (`/change-password`) in `GoRouterConfig.router`.

---

### 3.4 AuthGate & Application Startup Lifecycle

To maintain complete security boundary enforcement across app restarts and navigation transitions, the startup gatekeeper (`lib/app/auth_gate.dart`) must enforce strict routing interception rules.

* **Startup Rule**: When the application initializes or restarts, `AuthGate` verifies existing session tokens (`AppPreferences.hasSessionTokens()`) and retrieves the latest user profile (`getCurrentUser`).
* **Interception**: If `user.forcePasswordChange == true` at startup (or immediately following a successful login), entry to `MainScreen.mainRoute` is strictly forbidden.
* **Redirection & Protected Routes**: `AuthGate` must instantly intercept the navigation pipeline and redirect the user directly to `ChangePasswordScreen.routeName` using `context.go`. 
* **Exclusive Access Rule**: While `forcePasswordChange == true`, `ChangePasswordScreen` is the ONLY allowed route. Any attempt to navigate to or access other protected routes must automatically redirect to `ChangePasswordScreen` until the password is successfully updated.

---

## 4. Localization & Arabic UI Copy Requirements

To maintain strict alignment with dashboard contracts and corporate presentation standards, all user-facing strings, titles, and error prompts in the Flutter application must be fully localized in Arabic within `lib/presentation/resources/strings_manager.dart`.

| Key / Context | Arabic UI Copy (Required) | English Translation / Intent |
| :--- | :--- | :--- |
| `invalidCredentials` | `رقم الجوال أو كلمة المرور غير صحيحة` | Invalid phone or password (Generic error) |
| `forcePasswordChangeTitle` | `تغيير كلمة المرور الإجباري` | Mandatory Password Change |
| `forcePasswordChangeSubtitle` | `تمت إعادة تعيين كلمة مرورك من قبل الإدارة. يرجى تعيين كلمة مرور جديدة للمتابعة.` | Your password was reset by administration. Please set a new password to continue. |
| `passwordMismatch` | `كلمتا المرور غير متطابقتين` | Passwords do not match |
| `passwordChangedSuccess` | `تم تغيير كلمة المرور بنجاح` | Password changed successfully |
| `forgotPasswordSupportPrompt` | `لإعادة تعيين كلمة المرور، يرجى التواصل مع خدمة العملاء أو إدارة النظام.` | To reset your password, please contact customer support or system administration. |

---

## 5. QA Verification & Codex Prompt Guide

This checklist serves as the acceptance criteria for both the Flutter development team and Quality Assurance engineers.

### 5.1 Compilation & Generation
* [ ] Verify `flutter pub run build_runner build --delete-conflicting-outputs` executes successfully with zero conflicting outputs.
* [ ] Confirm clean compilation of the Flutter application with no broken imports or unhandled route definitions.

### 5.2 Registration Flow Verification
* [ ] Verify `RegisterScreen` renders two separate input fields for `password` and `confirmPassword`.
* [ ] Submit a valid phone number and matching passwords on `RegisterScreen`.
* [ ] Confirm that `VerifyScreen` (OTP prompt) is bypassed entirely and the user is navigated directly to `MainScreen.mainRoute`.
* [ ] Confirm session tokens (`accessToken` and `refreshToken`) are successfully stored in `AppPreferences`.

### 5.3 Login & AuthGate Flow Verification
* [ ] **Valid Credentials**: Log in with correct phone and password; confirm seamless navigation to `MainScreen.mainRoute`.
* [ ] **Invalid Credentials**: Log in with an incorrect password; verify the UI displays the generic Arabic error message: `"رقم الجوال أو كلمة المرور غير صحيحة"`.
* [ ] **Interception Flow**: Log in with an account that was recently reset by an administrator (`forcePasswordChange: true`).
  * Verify immediate redirection to `ChangePasswordScreen` via `context.go` (confirming back navigation is blocked).
  * Confirm that NO passwords were passed via `route extras`.
  * Verify `MainScreen.mainRoute` and all other protected routes are NOT accessible and actively redirect to `ChangePasswordScreen`.
  * **App Restart Test**: Force close and restart the app while `forcePasswordChange: true`. Verify `AuthGate` intercepts startup and immediately routes back to `ChangePasswordScreen`.
  * Submit `currentPassword` (entered manually by user) and matching new passwords on `ChangePasswordScreen`; verify successful update, snackbar confirmation (`"تم تغيير كلمة المرور بنجاح"`), and navigation to `MainScreen.mainRoute`.

### 5.4 System Integrity & Support Verification
* [ ] Confirm that clicking "Forgot Password" leads to the static support screen displaying `"لإعادة تعيين كلمة المرور، يرجى التواصل مع خدمة العملاء أو إدارة النظام."` with no OTP or self-service reset forms present.
* [ ] Verify that cash subscriptions created via the Dashboard are fetched and rendered flawlessly on `SubscriptionScreen` without requiring any changes to subscription mappers or models.
* [ ] Confirm `AppPreferences`, secure storage, logs, analytics, and crash reports are clean of any plain-text passwords.

---

## 6. Copy-Paste Codex Prompt for Flutter Implementation

Flutter developers can copy and paste the following comprehensive prompt directly into Codex, Copilot, or any AI coding assistant within the Flutter mobile repository (`/home/hema/Projects/full app/mobile_app`) to instantly apply all necessary client-side modifications without altering backend or dashboard services.

```text
You are a senior Flutter engineer implementing the transition to a password-based customer authentication system in our Flutter mobile application.
Do NOT modify any backend or dashboard code. All modifications must be confined to the Flutter repository, adhering to Clean Architecture and Bloc state management principles.

### Architecture & Security Rules to Follow Strictly:
1. **Sensitive Data Handling**: Do NOT store `currentPassword`, `newPassword`, or `confirmPassword` in `AppPreferences`, secure storage, logs, analytics, crash reports, or long-lived Bloc state. All password fields must use `obscureText: true`, and controllers must be cleared (`controller.clear()`) and disposed of when practical.
2. **Retrofit Path Convention**: In `app_api.dart`, use the exact endpoint style currently established. If `baseUrl` already includes `/api`, do not duplicate `/api` in `@POST` paths.
3. **No Passwords in Route Extras**: When navigating to `ChangePasswordScreen`, never pass `temporaryPassword` or `currentPassword` in `route extras`. The screen must explicitly prompt the user for `currentPassword` again or rely on an unpersisted, ephemeral in-memory state.
4. **Context.go & Exclusive Access**: When `user.forcePasswordChange == true`, use `context.go` to navigate to `ChangePasswordScreen` to prevent backward navigation. `ChangePasswordScreen` becomes the ONLY allowed route; `AuthGate` and all protected routes must actively redirect to it until the password is successfully changed.
5. **OTP Bypass**: OTP is no longer the primary flow. Bypass `VerifyScreen` entirely during registration and login.
6. **Arabic UI Copy**: Ensure all user-facing strings are added in `strings_manager.dart` in Arabic.

### Step-by-Step Implementation Tasks:

1. **Data & Domain Layer Updates**:
   - In `lib/data/response/auth_response.dart`, add `final bool? forcePasswordChange;` to `AuthUserResponse`. Run `flutter pub run build_runner build --delete-conflicting-outputs`.
   - In `lib/data/network/app_api.dart`, add `@POST("/api/auth/register") Future<AuthenticationResponse> register(@Body() Map<String, dynamic> body);` and `@POST("/api/auth/change-password") Future<BaseResponse> changePassword(@Body() Map<String, dynamic> body);` (adjusting `/api` prefix to match existing `baseUrl` conventions).
   - In `lib/data/mappers/auth_mapper.dart`, update `AuthUserResponse.toDomain()` to map `forcePasswordChange: forcePasswordChange ?? false`.
   - In `lib/domain/model/auth_model.dart`, add `bool forcePasswordChange;` to `AuthUserModel`.
   - In `lib/domain/repository/repository.dart` and `lib/data/repository/repository.dart`, add and implement `register(phone, password, confirmPassword, {email})` and `changePassword(currentPassword, newPassword, confirmPassword)`. Ensure errors are handled via `_handleError`.

2. **Presentation Layer & Bloc Updates**:
   - In `lib/presentation/register/register_screen.dart`, add two separate text fields for `password` and `confirmPassword` using `AppTextField.password`. In `RegisterBloc`, validate `password == confirmPassword`. On `RegisterSuccessState`, call `AppPreferences.saveSession` and navigate directly to `MainScreen.mainRoute` via `context.go()`, bypassing `VerifyScreen`.
   - In `lib/presentation/login/login_bloc.dart`, check `authenticationModel.user.forcePasswordChange`. If true, emit `LoginForcePasswordChangeRequiredState(phone: phone)`. If false, emit `LoginSuccessState`. In `login_screen.dart` `BlocListener`, handle `LoginSuccessState` with `context.go(MainScreen.mainRoute)` and `LoginForcePasswordChangeRequiredState` with `context.go(ChangePasswordScreen.routeName, extra: state.phone)`.
   - Create `lib/presentation/change_password/` module (`ChangePasswordScreen`, `ChangePasswordBloc`). Provide three input fields: `currentPassword`, `newPassword`, and `confirmPassword`. Validate `newPassword == confirmPassword`. On success, display SnackBar `"تم تغيير كلمة المرور بنجاح"`, clear controllers, and navigate to `MainScreen.mainRoute`.
   - In `lib/presentation/forgot_password/forgot_password_screen.dart`, remove all OTP request inputs/buttons. Replace with static text: `"لإعادة تعيين كلمة المرور، يرجى التواصل مع خدمة العملاء أو إدارة النظام."`.
   - In `lib/presentation/resources/routes_manager.dart`, register `ChangePasswordScreen.routeName`.

3. **AuthGate & Startup Rules**:
   - In `lib/app/auth_gate.dart`, verify session tokens and fetch current user profile. If `user.forcePasswordChange == true`, instantly redirect to `ChangePasswordScreen.routeName` using `context.go`. Ensure all protected routes enforce this exclusive access rule.

4. **Arabic UI Localization (`strings_manager.dart`)**:
   - Add the following key-value pairs:
     - `invalidCredentials`: `رقم الجوال أو كلمة المرور غير صحيحة`
     - `forcePasswordChangeTitle`: `تغيير كلمة المرور الإجباري`
     - `forcePasswordChangeSubtitle`: `تمت إعادة تعيين كلمة مرورك من قبل الإدارة. يرجى تعيين كلمة مرور جديدة للمتابعة.`
     - `passwordMismatch`: `كلمتا المرور غير متطابقتين`
     - `passwordChangedSuccess`: `تم تغيير كلمة المرور بنجاح`
     - `forgotPasswordSupportPrompt`: `لإعادة تعيين كلمة المرور، يرجى التواصل مع خدمة العملاء أو إدارة النظام.`

Please verify the changes compile cleanly and do not leave any plaintext passwords in state or logs.
```
