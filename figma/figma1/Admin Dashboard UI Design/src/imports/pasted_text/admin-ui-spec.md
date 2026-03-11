━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PAGE 16: KITCHEN (/kitchen)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Top bar: Date picker (defaults to today) + 
  "Bulk Lock All Days" danger button + 
  Result summary badge (X locked / X skipped)

Subscription Days section:
  Table columns:
    - Subscription ID | User Name | Status badge | 
      Selections | Delivery Mode | Actions
  
  Status-based action buttons per row:
    - If "open": [Assign Meals] [Lock Day] [Assign modal]
    - If "locked": [Reopen] [→ In Preparation]
    - If "in_preparation": [→ Out for Delivery] or [→ Ready for Pickup]
  
  "Assign Meals" side panel/modal:
    - Subscription info at top
    - Multi-select for regular meal selections
    - Multi-select for premium meal selections
    - Save button

One-time Orders section (below or separate tab):
  Table columns:
    - Order ID | User | Items | Status badge | Delivery Mode | Actions
  Action buttons per status:
    - confirmed → [→ Preparing]
    - preparing → [→ Out for Delivery] or [→ Ready for Pickup] or [→ Fulfilled]
    - ready_for_pickup → [→ Fulfilled]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PAGE 17: COURIER (/courier)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Two tabs at top: "Subscription Deliveries" | "One-time Orders"

Tab 1 - Subscription Deliveries:
  Shows today's deliveries automatically
  Table columns:
    - Delivery ID | User Address | Window | 
      Status badge | ETA | Actions
  Action buttons:
    - "Arriving Soon" (yellow) → sets out_for_delivery
    - "Mark Delivered" (green) → fulfilled
    - "Cancel Delivery" (red)

Tab 2 - One-time Orders:
  Shows today's delivery orders
  Table columns:
    - Order ID | User | Address | Window | Status badge | Actions
  Action buttons:
    - "Mark Delivered" (green)
    - "Cancel" (red)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PAGE 18: SETTINGS (/settings)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Vertical tabs layout on left, content on right:

Tab 1 - "General":
  - Cutoff Time: time picker input + Save
  - Skip Allowance: number input + Save
  - VAT Percentage: number input (0-100) + Save

Tab 2 - "Pricing":
  - Premium Price: number input (SAR) + Save
  - Subscription Delivery Fee: number input (Halala → shows SAR) + Save
  - Custom Salad Base Price: number input + Save

Tab 3 - "Delivery Windows":
  - List of current windows (chips/tags)
  - Add new window input
  - Delete window button per chip
  - Save All button

Tab 4 - "System":
  - "Trigger Cutoff Job" button (danger, with confirm modal)
  - Result message display area

═══════════════════════════════════════
ADDITIONAL UI DETAILS
═══════════════════════════════════════

STATUS BADGES COLOR MAPPING:
  Subscription:
    pending_payment → gray
    active → green
    expired → orange  
    canceled → red

  Day Status:
    open → blue
    frozen → light blue
    locked → orange
    in_preparation → yellow
    out_for_delivery → purple
    ready_for_pickup → teal
    fulfilled → green
    skipped → gray

  Payment:
    initiated → gray
    paid → green
    failed → red
    canceled → orange
    expired → dark gray
    refunded → blue

  Order:
    created → gray
    confirmed → blue
    preparing → yellow
    out_for_delivery → purple
    ready_for_pickup → teal
    fulfilled → green
    canceled → red

ROLE-BASED SIDEBAR VISIBILITY:
  superadmin / admin → all pages
  kitchen → Kitchen page only
  courier → Courier page only

MODALS NEEDED:
  - Confirm Delete (generic reusable)
  - Confirm Cancel Subscription
  - Extend Subscription (days input form)
  - Add/Edit Staff
  - Add/Edit Meal
  - Add/Edit Premium Meal
  - Add/Edit Addon
  - Add/Edit Salad Ingredient
  - Reset Password
  - Assign Meals (kitchen)
  - Confirm Trigger Cutoff

TABLE FEATURES:
  - Sortable column headers
  - Search/filter bar above
  - Pagination (10/25/50 per page)
  - Row hover highlight
  - Bulk select checkbox (where applicable)
  - Empty state illustration + message

RESPONSIVE:
  Design for 1440px desktop width primarily.
  Sidebar collapses to icons-only at 1024px.
