# Dashboard & Mobile Changes Required
## Admin-Initiated User Registration & Password Reset

This document outlines the API changes and required UI updates for the frontend applications (Dashboard and Mobile App) to fully support the new user pre-registration and password reset flows.

---

## 1. Admin Dashboard

The Admin Dashboard requires new UI states and uses modified API behaviors to create users by phone and trigger password resets.

### 1.1 Add User (Pre-Registration)

**Functionality**: Allow admins to create a "Pending Activation" account using only a phone number.

**API Endpoint**: `POST /api/admin/users` (Existing endpoint, modified behavior)
- **Request Body**:
  ```json
  {
    "phone": "+966500000000",
    "fullName": "Optional Name",
    "email": "optional@example.com"
  }
  ```
  *(Note: No password is sent or required.)*
- **Response**: The backend will return a standard success response. The newly created user will have an `accountStatus` of `"pending_activation"`.
- **UI Requirement**:
  - Provide an "Add User" button on the Users list page.
  - Show a modal/form requesting Phone Number (required), Full Name (optional), and Email (optional).
  - Submit the form to the existing `POST /api/admin/users` endpoint.

### 1.2 Trigger Password Reset

**Functionality**: Allow admins to clear a user's password and require them to set a new one the next time they open the mobile app.

**API Endpoint**: `POST /api/admin/users/:id/reset-password` (Existing endpoint, modified behavior)
- **Request Body**:
  ```json
  {
    "reason": "User requested reset over phone"
  }
  ```
  *(Note: The old requirement to send `newPassword` and `confirmPassword` has been removed. The backend handles clearing the password internally.)*
- **Response**:
  ```json
  {
    "status": true,
    "message": "Password reset requested successfully",
    "data": {
      "userId": "...",
      "accountStatus": "reset_requested",
      "resetRequestedAt": "2023-10-10T10:00:00.000Z"
    }
  }
  ```
- **UI Requirement**:
  - On the User Details page or Users List row, add a "Trigger Password Reset" button.
  - When clicked, optionally ask the admin for a `reason`, then call the endpoint without passing any passwords.
  - Show a success message to the admin indicating that the user has 48 hours to open the app and set a new password.

### 1.3 User Status Display
- **UI Requirement**: The Users List and User Details pages should ideally surface the new `accountStatus` field (`"active"`, `"pending_activation"`, or `"reset_requested"`) so admins know the current state of the account.

---

## 2. Mobile App

The Mobile App requires new error handling during login and needs to seamlessly route users to the "Create Password" flow.

### 2.1 Login Error Handling

**Functionality**: Detect when a user logs in but needs to set a password due to an admin action.

**API Endpoint**: `POST /api/auth/login`
- **New Responses**:
  1. **Pending Activation**:
     ```json
     {
       "status": false,
       "error": { "code": "PENDING_ACTIVATION", "message": "Account pending activation. Please set a password." }
     }
     ```
     *HTTP Status: 403 Forbidden*
  2. **Password Reset Requested**:
     ```json
     {
       "status": false,
       "error": { "code": "RESET_REQUESTED", "message": "Password reset requested. Please set a new password." }
     }
     ```
     *HTTP Status: 403 Forbidden*
  3. **Reset Window Expired**:
     ```json
     {
       "status": false,
       "error": { "code": "RESET_WINDOW_EXPIRED", "message": "The password reset window has expired. Please contact support." }
     }
     ```
     *HTTP Status: 403 Forbidden*

- **UI Requirement**:
  - When the app receives `PENDING_ACTIVATION` or `RESET_REQUESTED`, it should **immediately navigate the user to the "Create Password" screen** (the same two-field password screen used during normal registration).
  - When the app receives `RESET_WINDOW_EXPIRED`, it should show an error dialog informing the user that their 48-hour reset window has expired and they must contact support to request a new one.

### 2.2 Setting the Password (Registration Flow)

**Functionality**: Submit the new password for an existing `pending_activation` or `reset_requested` account.

**API Endpoint**: `POST /api/auth/register` (Existing endpoint, modified behavior)
- **Request Body**:
  ```json
  {
    "phone": "+966500000000",
    "password": "newSecurePassword123",
    "confirmPassword": "newSecurePassword123"
  }
  ```
- **Backend Behavior**: The backend will recognize the existing account, validate the 48-hour window (if applicable), update the password, switch the `accountStatus` to `"active"`, and log the user in successfully.
- **UI Requirement**:
  - No new UI needed. Simply reuse the existing Registration form submission logic.
  - Ensure the app handles `403 RESET_WINDOW_EXPIRED` from this endpoint as well, just in case the window expires while they are typing their password.
