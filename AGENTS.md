# AGENTS.md — Basic Diet Flutter App

This document describes the project structure, architecture, conventions, and guidelines for AI agents (and developers) working on this codebase.

---
## AI Agent Instructions

You are a **professional senior Flutter developer**. When generating or modifying code in this project, strictly follow these principles:

### Core Mindset
- Write clean, readable, maintainable Dart/Flutter code
- Apply **SOLID principles** at every layer
- Favor **composition over inheritance**
- Keep every class, method, and widget focused on a **single responsibility**
- Write the **absolute minimal code** needed — no over-engineering, no unused abstractions

### Architecture Rules
- Always follow the **Clean Architecture** layers: `presentation → domain → data`
- Never import `data` layer classes directly into `presentation` — go through `domain`
- Never put business logic in widgets or BLoCs beyond orchestration — delegate to use cases
- Domain models must remain **pure Dart** — no Flutter, no JSON annotations
- Repository implementations live in `data/repository/`, interfaces in `domain/repository/`

### BLoC / State Management
- Use `Bloc` for complex event-driven flows, `Cubit` for simple state toggles
- Events must be **sealed classes** (Dart 3+); states must extend `Equatable`
- Always implement `copyWith` on state classes
- BLoC handlers must be thin — call a use case, fold the result, emit a state
- Never call `emit` after `close()` — guard with `if (!isClosed)`

### Use Cases
- One use case per operation, extending `BaseUseCase<Input, Output>`
- Return `Future<Either<Failure, T>>` — never throw exceptions out of use cases
- Input objects should be simple value classes (use `Equatable` or plain records)

### Widgets & UI
- Extract any widget that is reused more than once into `presentation/widgets/`
- Keep screen files thin — delegate complex UI sections to private widget methods or separate widget classes
- Use `flutter_screenutil` (`.w`, `.h`, `.sp`, `.r`) for all sizing — no hardcoded pixel values
- Use `ColorManager`, `StylesManager`, `FontManager`, and `ValuesManager` — never inline colors, font sizes, or raw spacing numbers
- All user-facing strings must use `'key'.tr()` — never hardcode text
- Add keys to `strings_manager.dart` and both translation files (`en-US.json`, `ar-SA.json`) for every new string

### Dependency Injection
- Register every new feature in its own `init*Module()` function in `dependency_injection.dart`
- Call `init*Module()` inside the route builder, reset on exit
- Never use `GetIt` directly inside widgets — inject via BLoC constructor

### Networking & Data
- Add new endpoints to `app_api.dart` using Retrofit annotations, then run `build_runner`
- New response DTOs go in `data/response/`, request DTOs in `data/request/` — always annotate with `@JsonSerializable`
- Add a mapper in `data/mappers/` for every new response → domain model conversion
- Expose the new method on `RemoteDataSource` (abstract) and implement in `RemoteDataSourceImpl`
- Add the method to the `Repository` interface and implement in `RepositoryImpl` with `Either` wrapping

### Error Handling
- Wrap all remote calls in `try/catch` inside `RepositoryImpl`, map to `Failure` via `ExceptionHandler`
- BLoCs must always handle both `Left(failure)` and `Right(data)` branches — never ignore failures
- Show user-friendly error messages using the toast handler or a dedicated error state in the UI

### Localization
- Every new screen or widget with visible text needs corresponding keys in both JSON translation files
- RTL layout must be considered — use `Directionality`-aware widgets and avoid hardcoded `left`/`right` padding

### Code Quality
- No `print()` statements — use the Dio logger interceptor or a proper logging utility
- No commented-out code in final commits
- Prefer `const` constructors wherever possible
- Avoid `dynamic` types — always be explicit
- Run `flutter analyze` mentally before finalizing any file; fix all warnings

### File Naming
- Files: `snake_case.dart`
- Classes: `PascalCase`
- Variables/methods: `camelCase`
- Constants: `camelCase` (prefixed contextually, e.g., `AppConstants.baseUrl`)
- BLoC files: `feature_bloc.dart`, `feature_event.dart`, `feature_state.dart`


## Project Overview

**basic_diet** is a Flutter mobile application for managing diet subscriptions. It supports meal plan browsing, subscription checkout, delivery management, meal planning, and subscription actions (freeze, skip days, pickup).

- **Platform**: Flutter (iOS & Android)
- **Language**: Dart (SDK `>=3.7.0 <4.0.0`)
- **Localization**: English (`en-US`) and Arabic (`ar-SA`)

---

## Architecture

The project follows **Clean Architecture** with **BLoC** as the state management pattern.

```
UI (Presentation) → BLoC → Use Case → Repository Interface → Repository Impl → Remote Data Source → API
```

### Layers

| Layer | Location | Responsibility |
|---|---|---|
| Presentation | `lib/presentation/` | Screens, BLoCs, Cubits, shared widgets, resources |
| Domain | `lib/domain/` | Use cases, domain models, repository contracts |
| Data | `lib/data/` | API client, responses, requests, mappers, repository impl |
| App | `lib/app/` | DI setup, preferences, constants, extensions, utilities |

### Data Flow

1. User interacts with a screen → triggers a **BLoC Event**
2. BLoC calls a **Use Case** (`domain/usecase/`)
3. Use Case calls the **Repository interface** (`domain/repository/`)
4. **RepositoryImpl** (`data/repository/`) delegates to **RemoteDataSource**
5. RemoteDataSource calls the **Retrofit API client** (`data/network/app_api.dart`)
6. Response is mapped via a **Mapper** to a domain model
7. Result is returned as `Either<Failure, T>` (functional error handling via `dartz`)
8. BLoC emits a new **State** → UI rebuilds

---

## Project Structure

```
lib/
├── main.dart                        # Entry point
├── app/
│   ├── app.dart                     # Root widget (MyApp)
│   ├── app_pref.dart                # Shared preferences wrapper
│   ├── constants.dart               # App-wide constants (base URL, etc.)
│   ├── dependency_injection.dart    # GetIt DI setup (initAppModule, feature modules)
│   ├── extensions.dart              # Dart extension methods
│   ├── functions.dart               # Utility functions (navigator key, transitions)
│   └── toast_handeller.dart         # Toast notification helper
│
├── domain/
│   ├── bloc_observer.dart           # Global BLoC lifecycle observer
│   ├── model/                       # Pure domain models (no JSON annotations)
│   │   ├── auth_model.dart
│   │   ├── plans_model.dart
│   │   ├── subscription_quote_model.dart
│   │   └── ...
│   ├── repository/
│   │   └── repository.dart          # Abstract Repository interface
│   └── usecase/
│       ├── base_usecase.dart        # BaseUseCase<Input, Output> contract
│       ├── login_usecase.dart
│       ├── get_plans_usecase.dart
│       └── ...
│
├── data/
│   ├── network/
│   │   ├── app_api.dart             # Retrofit API client (+ app_api.g.dart generated)
│   │   ├── dio_factory.dart         # Dio setup with interceptors (auth, language, logging)
│   │   ├── exception_handler.dart   # Maps DioException to Failure
│   │   ├── failure.dart             # Failure model + error codes
│   │   └── network_info.dart        # Internet connectivity checker
│   ├── data_source/
│   │   ├── remote_data_source.dart       # Abstract data source interface
│   │   └── remote_data_source_impl.dart  # Concrete implementation
│   ├── repository/
│   │   └── repository.dart          # RepositoryImpl (implements domain Repository)
│   ├── mappers/                     # Response → Domain model converters
│   │   ├── login_mapper.dart
│   │   ├── plans_mapper.dart
│   │   └── ...
│   ├── request/                     # JSON-serializable request DTOs (+ .g.dart files)
│   │   ├── subscription_checkout_request.dart
│   │   └── ...
│   └── response/                    # JSON-serializable response DTOs (+ .g.dart files)
│       ├── base_response/
│       │   └── base_response.dart
│       ├── plans_response.dart
│       └── ...
│
└── presentation/
    ├── resources/                   # Design system
    │   ├── assets_manager.dart      # Asset path constants
    │   ├── color_manager.dart       # Color palette
    │   ├── font_manager.dart        # Font families & sizes
    │   ├── styles_manager.dart      # TextStyle definitions
    │   ├── theme_manager.dart       # ThemeData
    │   ├── routes_manager.dart      # GoRouter configuration
    │   ├── language_manager.dart    # Locale definitions
    │   ├── strings_manager.dart     # Localization keys
    │   └── values_manager.dart      # Spacing/sizing constants
    ├── widgets/                     # Shared reusable widgets
    ├── splash/                      # Splash screen
    ├── onboarding/                  # Onboarding walkthrough
    ├── login/                       # Login (BLoC + screen + events + states)
    ├── register/                    # Registration
    ├── verify/                      # OTP verification
    └── main/                        # Bottom-nav shell
        ├── main_screen.dart
        ├── bloc/                    # MainBloc (tab switching)
        ├── home/                    # Home tab
        │   ├── home_screen.dart
        │   ├── bloc/                # HomeBloc
        │   ├── subscription/        # Subscription flow + SubscriptionBloc
        │   ├── subscription-details/
        │   ├── add-ons/             # Add-ons screen + AddOnsBloc
        │   ├── premium/             # Premium meals + PremiumMealsBloc
        │   ├── delivery/            # Delivery options + DeliveryOptionsBloc
        │   ├── payment-success/     # PaymentValidationCubit
        │   └── widgets/
        ├── orders/                  # Orders screen
        ├── menu/                    # Menu screen
        ├── profile/                 # Profile screen
        └── plans/                   # Plans tab
            ├── plans_screen.dart
            ├── bloc/                # PlansBloc
            ├── timeline/            # Timeline + TimelineBloc + MealPlannerBloc
            ├── pickup_status/       # PickupStatusCubit
            └── manage_subscription/
                ├── freeze/          # FreezeSubscriptionBloc
                ├── skip/            # SkipDaysBloc
                └── delivery_settings/
```

---

## Key Conventions

### BLoC Structure
Each feature folder contains:
- `*_bloc.dart` — BLoC class with event handlers
- `*_event.dart` — Sealed/abstract event classes
- `*_state.dart` — Immutable state classes (use `copyWith`, extend `Equatable`)

Cubits are used for simpler, single-concern state (e.g., `PickupStatusCubit`, `PaymentValidationCubit`).

### Use Cases
All use cases extend `BaseUseCase<Input, Output>` and return `Future<Either<Failure, Output>>`. Single-responsibility: one use case per operation.

### Error Handling
- All repository methods return `Either<Failure, T>` from `dartz`
- `Failure` carries a status code and message
- `ExceptionHandler` maps `DioException` types to `Failure`
- BLoCs call `.fold()` on the result to emit success or error states

### Dependency Injection
- `GetIt` is used as a service locator (`instance` singleton in `dependency_injection.dart`)
- `initAppModule()` runs at startup (registers Dio, API client, repository, core use cases)
- Feature modules (e.g., `initLoginModule()`) are registered lazily when a route is navigated to, then reset on exit

### Navigation
- `GoRouter` with all routes defined in `routes_manager.dart`
- Each route calls its feature's `init*Module()` before building the screen
- BLoCs are passed to child routes via `BlocProvider.value` using `GoRouterState.extra`

### Networking
- Retrofit generates the API client from `app_api.dart` → run `build_runner` after changes
- Dio interceptors handle: Bearer token injection, `Accept-Language` header, debug logging
- Retry logic is implemented in `RepositoryImpl` for the checkout endpoint (5 retries, 1s delay)

### Localization
- Keys defined in `strings_manager.dart`
- Translations in `assets/translations/en-US.json` and `assets/translations/ar-SA.json`
- Use `'key'.tr()` from `easy_localization` in widgets

### Code Generation
Files ending in `.g.dart` are generated — do not edit them manually. Regenerate with:
```bash
flutter pub run build_runner build --delete-conflicting-outputs
```

---

## Dependencies Summary

| Package | Purpose |
|---|---|
| `flutter_bloc` / `bloc` | State management |
| `dartz` | Functional Either type for error handling |
| `dio` + `retrofit` | HTTP client + type-safe API layer |
| `get_it` | Dependency injection / service locator |
| `go_router` | Declarative navigation |
| `easy_localization` | i18n (EN/AR) |
| `flutter_screenutil` | Responsive sizing |
| `equatable` | Value equality for BLoC states/events |
| `flutter_secure_storage` | Secure token storage |
| `rxdart` | Reactive stream utilities |
| `json_serializable` | JSON code generation for DTOs |
| `internet_connection_checker` | Network connectivity |
| `flutter_phoenix` | App restart utility |

---

## Assets

```
assets/
├── fonts/        # Arimo (Regular, Bold, Italic, BoldItalic)
├── icons/        # SVG icons (home, orders, plans, profile, etc.)
├── images/       # PNG/JPEG images (logo, onboarding, subscription)
├── translations/ # en-US.json, ar-SA.json
└── json/         # (reserved for local JSON data)
```

---

## Running the Project

```bash
# Install dependencies
flutter pub get

# Regenerate code (after modifying API, requests, or responses)
flutter pub run build_runner build --delete-conflicting-outputs

# Run on a connected device
flutter run

```

---

