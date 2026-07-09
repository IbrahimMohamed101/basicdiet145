# 📱 Flutter Integration Guide: Meal & Addon Calculations

This document is the definitive guide for the Flutter frontend developer to correct the meal and addon calculation issues. It contains the exact payloads, required UI inputs, and API responses needed to eliminate the "Phantom Invoices" (red payment bar) and synchronize perfectly with the backend.

---

## 🛑 The Core Problem: Why does the Red Payment Bar appear?
Currently, the mobile app shows the red banner `يوجد مبالغ معلقة يجب سدادها قبل التحضير` because the Flutter app is **calculating the price locally** and doing a **Double Deduction** on balances. 

The Backend is already returning that the user has **21 free addons** and requires **0 payment**, but the Flutter app ignores this and calculates its own total based on UI selections. 

**Rule of Thumb:** The Flutter app MUST NOT calculate extra fees or remaining balances locally. It must rely 100% on the backend's `paymentRequirement` and `addonBalance` responses.

---

## 🛠️ 1. Fetching the Day (GET) & UI Data Binding
When you fetch the subscription day (or meal planner data), the backend returns a comprehensive state.

### Backend Response Example (GET `/client/days/:date`)
```json
{
  "date": "2026-07-09",
  "status": "open",
  
  // 1. ADDON BALANCE (Rely on this for UI indicators!)
  "addonBalance": [
    {
      "category": "juice",
      "remainingQty": 7    // Show "مشمول" in UI if > 0
    },
    {
      "category": "snack",
      "remainingQty": 7
    },
    {
      "category": "small_salad",
      "remainingQty": 7
    }
  ],

  // 2. PAYMENT REQUIREMENT (Rely on this for the Red Bar!)
  "paymentRequirement": {
    "requiresPayment": false,           // IF FALSE, HIDE THE RED BAR!
    "pendingAmountHalala": 0,           // The exact amount to pay (if requiresPayment is true)
    "currency": "SAR",
    "blockingReason": null              // "ADDON_PAYMENT_REQUIRED" or "PREMIUM_UPGRADE_REQUIRED"
  }
}
```

### 🖥️ Frontend UI Actions for GET:
1. **The Red Bar:** Only show `يوجد مبالغ معلقة يجب سدادها` IF AND ONLY IF `paymentRequirement.requiresPayment == true`. Do not calculate this locally.
2. **Addon Menu "Included" Labels:** Loop through the `addonBalance` array. If the user selects a Juice, check `addonBalance.find(a => a.category == 'juice').remainingQty`. If it is `> 0`, display the green "مشمول" (Included) label. 

---

## 🛠️ 2. Validating Selections (POST `/validate`)
Whenever the user changes a meal or an addon, do NOT calculate the price locally. Instead, send a `POST` request to the validation endpoint. The backend will simulate the save and tell you exactly what the new price and balance will be.

**Endpoint:** `POST /api/client/subscriptions/{id}/days/{date}/selection/validate`

### Payload from Flutter (The Request)
You must send the exact state of the day's meals and addons.

```json
{
  "selections": [
    {
      "slotIndex": 1,                     // (Integer) NEVER CHANGE THIS ON DELETE. This is the Primary Key.
      "menuProductId": "6a3e87...",       // (String) ID of the selected Meal
      "variantId": "6a3e87...",           // (String) ID of the variant
      "modifiers": ["6a3...", "6b4..."],  // (Array of Strings) Multi-select checkboxes
      "proteinId": null,                  // (String or Null) Select Box for protein type. Send null if no protein.
      "comment": "No onions"              // (String) Text input
    }
  ],
  "addonSelections": [
    {
      "addonId": "6a3e87...",             // (String) The ID of the addon item selected
      "qty": 1                            // (Integer) Quantity selected for THIS specific addon on THIS day
    }
  ]
}
```

### 🖥️ Frontend UI Actions for Validate:
1. **`slotIndex` Rule:** If the user deletes `slotIndex: 1`, DO NOT re-index the remaining meals to 1, 2, 3. Keep their original `slotIndex` (e.g., 2, 3, 4). The backend uses this to know exactly which slot was deleted.
2. **Addons:** Send the exact `addonId` and `qty` (which is typically a counter/number input in the UI). 

### Backend Response to Validate (The Response)
The backend will respond with the simulated state:

```json
{
  "valid": true,
  "paymentRequirement": {
    "requiresPayment": true,              // Now the user exceeded the limit!
    "pendingAmountHalala": 1500,          // They owe 15.00 SAR
    "currency": "SAR",
    "blockingReason": "ADDON_PAYMENT_REQUIRED"
  },
  "addonSummary": {
    "coveredBySubscription": 7,
    "pendingPayment": 1
  }
}
```

### 🖥️ Frontend UI Actions for Validation Response:
1. **Update State:** Take the `paymentRequirement` from this response and update your UI state. 
2. **Show Payment Button:** Because `requiresPayment` is now `true`, show the Red Bar and the "Pay 15.00 SAR" button.

---

## 🛠️ 3. Saving the Day (PUT)
Once the user hits "Save Changes" (حفظ التغييرات), send the exact same payload used in `/validate` to the save endpoint.

**Endpoint:** `PUT /api/client/subscriptions/{id}/days/{date}/selections`

### Payload
```json
{
  "selections": [ ... ],
  "addonSelections": [ ... ]
}
```

### Handling the Response
If the user tries to save while they owe money (and bypassed the validate step), the backend will throw a strict `402 Payment Required` error.

**Error Response (402):**
```json
{
  "status": 402,
  "code": "ADDON_PAYMENT_REQUIRED",
  "message": "Selections exceed allowed quota or require payment.",
  "details": {
    "requiresPayment": true,
    "pendingAmountHalala": 1500
  }
}
```

### 🖥️ Frontend UI Actions for 402 Error:
1. Catch the `402` status code in your network layer (`Dio` or `http`).
2. Do NOT show a generic "Server Error". 
3. Automatically trigger the Unified Payment Flow (`VerifyUnifiedDayPaymentEvent`) to open the payment gateway (Moyasar) for `1500` Halala.
4. Once the payment succeeds, the backend will automatically lock the selections in.

---

## 🎯 Summary of Required Flutter Changes
1. **Remove `evaluatePremiumUsage()` local math:** Stop calculating `premiumSummaries` and `billableSlots` locally. It causes Double Deductions.
2. **Bind the Red Bar to `requiresPayment`:** The UI should only ever show "يوجد مبالغ معلقة" if the API explicitly returns `requiresPayment: true`.
3. **Stop Re-indexing `slotIndex`:** When removing a meal, delete it from the array but preserve the `slotIndex` of the remaining meals.
4. **Use `/validate` endpoint on every UI change:** Let the backend do the heavy lifting of calculating complex rules and returning the final `pendingAmountHalala`.
