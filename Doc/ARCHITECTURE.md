# BasicDiet145 – Architecture & Diagrams

This document provides visual architecture diagrams for the BasicDiet145 backend system.

---

## System Architecture Overview

```mermaid
graph TB
    subgraph "Client Applications"
        Mobile[Mobile App<br/>React Native / Flutter]
        Dashboard[Dashboard Web<br/>Admin / Kitchen / Courier]
    end

    subgraph "Backend API"
        Gateway[Express API Gateway<br/>Port 3000]
        Auth[Authentication Layer<br/>JWT / Better Auth]
        Routes[Route Handlers]
        Controllers[Business Logic Controllers]
        Services[Service Layer]
        Middleware[Middleware<br/>CORS, Helmet, Rate Limit]
    end

    subgraph "Data Layer"
        MongoDB[(MongoDB<br/>Database)]
        Models[Mongoose Models]
    end

    subgraph "External Services"
        Firebase[Firebase<br/>Auth + FCM]
        Moyasar[Moyasar<br/>Payment Gateway]
    end

    subgraph "Background Jobs"
        CutoffJob[Daily Cutoff Job<br/>Runs every minute]
    end

    Mobile -->|JWT Bearer| Gateway
    Dashboard -->|Session Cookie| Gateway
    Gateway --> Middleware
    Middleware --> Auth
    Auth --> Routes
    Routes --> Controllers
    Controllers --> Services
    Services --> Models
    Models --> MongoDB
    
    Auth -.->|Verify ID Token| Firebase
    Services -.->|Send Notifications| Firebase
    Services -.->|Create Payment| Moyasar
    Moyasar -.->|Webhook| Gateway
    
    CutoffJob -->|Lock Days & Auto-assign| Services
    
    style Mobile fill:#e1f5ff
    style Dashboard fill:#fff4e1
    style MongoDB fill:#e8f5e9
    style Firebase fill:#ffe1e1
    style Moyasar fill:#f3e5f5
```

---

## Authentication Flow

### Client (Mobile) Authentication

```mermaid
sequenceDiagram
    actor User
    participant Mobile
    participant API
    participant Firebase
    participant DB

    User->>Mobile: Enter phone number
    Mobile->>API: POST /api/auth/otp/request
    API->>Firebase: Send OTP via Firebase Auth
    Firebase-->>User: SMS with OTP
    
    User->>Mobile: Enter OTP
    Mobile->>Firebase: Verify OTP
    Firebase-->>Mobile: ID Token
    
    Mobile->>API: POST /api/auth/otp/verify<br/>{idToken}
    API->>Firebase: Validate ID Token
    Firebase-->>API: Valid ✓
    API->>DB: Find or create User
    API->>API: Generate JWT
    API-->>Mobile: {token, user}
    
    Mobile->>API: Subsequent requests<br/>Authorization: Bearer {JWT}
    API->>API: Verify JWT
    API-->>Mobile: Protected resource
```

### Dashboard Authentication

```mermaid
sequenceDiagram
    actor Staff
    participant Dashboard
    participant BetterAuth
    participant DB

    Staff->>Dashboard: Enter email & password
    Dashboard->>BetterAuth: POST /api/dashboard-auth/sign-in
    BetterAuth->>DB: Verify credentials
    DB-->>BetterAuth: User found ✓
    BetterAuth->>BetterAuth: Create session
    BetterAuth-->>Dashboard: Set session cookie
    Dashboard-->>Staff: Logged in
    
    Staff->>Dashboard: Access admin panel
    Dashboard->>BetterAuth: Request with session cookie
    BetterAuth->>BetterAuth: Validate session
    BetterAuth-->>Dashboard: Authorized ✓
```

---

## Subscription Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Browsing: User opens app
    Browsing --> PlanSelection: Choose plan
    PlanSelection --> Checkout: Configure & checkout
    Checkout --> PendingPayment: Create subscription
    
    PendingPayment --> Active: Payment webhook<br/>(Moyasar paid)
    PendingPayment --> [*]: Payment failed/expired
    
    Active --> GenerateDays: Auto-generate<br/>SubscriptionDay records
    GenerateDays --> ActiveWithDays: Ready for use
    
    ActiveWithDays --> DailyOperations: Each day...
    
    state DailyOperations {
        [*] --> Open
        Open --> Locked: Cutoff passed<br/>or manual
        Locked --> InPreparation: Kitchen starts
        InPreparation --> OutForDelivery: Courier assigned
        InPreparation --> ReadyForPickup: Pickup mode
        OutForDelivery --> Fulfilled: Delivered
        ReadyForPickup --> Fulfilled: Customer picked up
        
        Open --> Skipped: User/system skips
        Fulfilled --> [*]
        Skipped --> [*]
    }
    
    ActiveWithDays --> Expired: End date reached
    Expired --> [*]
```

---

## SubscriptionDay State Machine

```mermaid
stateDiagram-v2
    [*] --> open: Day created
    
    open --> locked: Cutoff passed OR<br/>pickup prepare
    open --> skipped: User skips day
    
    locked --> in_preparation: Kitchen starts
    
    in_preparation --> out_for_delivery: Delivery mode
    in_preparation --> ready_for_pickup: Pickup mode
    
    out_for_delivery --> fulfilled: Courier delivers
    out_for_delivery --> skipped: Courier cancels
    
    ready_for_pickup --> fulfilled: Customer picks up
    
    fulfilled --> [*]
    skipped --> [*]
    
    note right of open
        User can:
        - Select meals
        - Add premium meals
        - Configure delivery
        - Add custom salad
    end note
    
    note right of locked
        Immutable snapshot created
        User cannot edit
    end note
    
    note right of fulfilled
        Credits deducted
        Fulfillment snapshot saved
    end note
```

---

## Order (One-Time) State Machine

```mermaid
stateDiagram-v2
    [*] --> created: User checkout
    
    created --> confirmed: Payment webhook<br/>(Moyasar paid)
    created --> canceled: Payment failed
    
    confirmed --> preparing: Kitchen starts
    
    preparing --> out_for_delivery: Delivery mode
    preparing --> ready_for_pickup: Pickup mode
    
    out_for_delivery --> fulfilled: Courier delivers
    out_for_delivery --> canceled: Courier cancels
    
    ready_for_pickup --> fulfilled: Customer picks up
    
    fulfilled --> [*]
    canceled --> [*]
```

---

## Payment Integration Flow

```mermaid
sequenceDiagram
    actor User
    participant Mobile
    participant API
    participant Moyasar
    participant Webhook
    participant DB

    User->>Mobile: Top-up premium credits
    Mobile->>API: POST /api/subscriptions/{id}/premium/topup
    API->>DB: Create Payment record<br/>status: initiated
    API->>Moyasar: Create payment URL
    Moyasar-->>API: {payment_url}
    API-->>Mobile: {payment_url}
    
    Mobile->>Moyasar: Redirect to payment page
    User->>Moyasar: Complete payment
    
    Moyasar->>Webhook: POST /webhooks/moyasar<br/>{event: paid}
    Webhook->>DB: Find Payment by ID
    Webhook->>Webhook: Idempotency check<br/>(applied flag)
    Webhook->>DB: Update Payment status: paid<br/>Set applied: true
    Webhook->>DB: Update Subscription<br/>premiumRemaining += count
    Webhook->>Webhook: Log activity
    Webhook-->>Moyasar: 200 OK
    
    Mobile->>API: GET /api/subscriptions/{id}
    API-->>Mobile: Updated premium balance
```

---

## Daily Cutoff Automation

```mermaid
flowchart TD
    Start([Cron Job<br/>Runs every minute]) --> CheckTime{Current time<br/>> Cutoff time?}
    
    CheckTime -->|No| End([End])
    CheckTime -->|Yes| FindDays[Find SubscriptionDay records<br/>date = tomorrow<br/>status = open]
    
    FindDays --> HasDays{Days found?}
    HasDays -->|No| End
    
    HasDays -->|Yes| Loop[For each day...]
    
    Loop --> CheckSelections{User selected<br/>meals?}
    
    CheckSelections -->|Yes| CreateSnapshot1[Create locked snapshot]
    CheckSelections -->|No| AutoAssign[Auto-assign<br/>default meals]
    
    AutoAssign --> CreateSnapshot2[Create locked snapshot]
    
    CreateSnapshot1 --> UpdateStatus[Update status: locked]
    CreateSnapshot2 --> UpdateStatus
    
    UpdateStatus --> SendNotif[Send FCM notification<br/>if configured]
    SendNotif --> LogActivity[Log activity]
    LogActivity --> NextDay{More days?}
    
    NextDay -->|Yes| Loop
    NextDay -->|No| End
    
    style Start fill:#e1f5ff
    style End fill:#e8f5e9
    style AutoAssign fill:#fff3e0
    style SendNotif fill:#f3e5f5
```

---

## Custom Salad Pricing Flow

```mermaid
sequenceDiagram
    actor User
    participant Mobile
    participant API
    participant SaladService
    participant DB

    User->>Mobile: Build custom salad<br/>Select ingredients
    Mobile->>API: POST /api/custom-salads/price<br/>{ingredients: [...]}
    API->>SaladService: Calculate price
    SaladService->>DB: Fetch ingredient prices
    DB-->>SaladService: Ingredient data
    SaladService->>SaladService: Validate quantities<br/>Calculate total
    SaladService-->>API: {totalPriceSar, items, calories}
    API-->>Mobile: Price preview
    
    User->>Mobile: Confirm & add to day/order
    Mobile->>API: POST .../custom-salad<br/>{ingredients: [...]}
    API->>SaladService: Re-calculate (server-side)
    SaladService-->>API: Validated price
    API->>DB: Create Payment record
    API->>Moyasar: Create payment URL
    Moyasar-->>API: {payment_url}
    API-->>Mobile: {payment_url}
```

---

## Data Model Relationships

```mermaid
erDiagram
    User ||--o{ Subscription : has
    User ||--o{ Order : places
    User ||--o{ Payment : makes
    User ||--o{ NotificationLog : receives
    
    Plan ||--o{ Subscription : defines
    
    Subscription ||--o{ SubscriptionDay : contains
    Subscription ||--o{ Payment : "paid for"
    Subscription }o--o{ Addon : "has (subscription addons)"
    
    SubscriptionDay }o--o{ Meal : "selections"
    SubscriptionDay }o--o{ Addon : "addonsOneTime"
    SubscriptionDay }o--|| SaladIngredient : "custom salads"
    
    Order }o--o{ Meal : items
    Order }o--|| SaladIngredient : "custom salads"
    Order ||--o| Payment : "paid by"
    
    DashboardUser ||--o{ ActivityLog : performs
    
    User {
        ObjectId _id PK
        String phone UK
        String name
        String role
        Boolean isActive
        Array fcmTokens
    }
    
    DashboardUser {
        ObjectId _id PK
        String email UK
        String role
        Boolean isActive
    }
    
    Plan {
        ObjectId _id PK
        String name
        Number daysCount
        Number mealsPerDay
        Number grams
        Number price
        Number skipAllowance
        Boolean isActive
    }
    
    Subscription {
        ObjectId _id PK
        ObjectId userId FK
        ObjectId planId FK
        String status
        Date startDate
        Date endDate
        Date validityEndDate
        Number totalMeals
        Number remainingMeals
        Number premiumRemaining
        Array addonSubscriptions
    }
    
    SubscriptionDay {
        ObjectId _id PK
        ObjectId subscriptionId FK
        Date date
        String status
        Array selections
        Array premiumSelections
        Array addonsOneTime
        Array customSalads
        Boolean creditsDeducted
        Object lockedSnapshot
        Object fulfilledSnapshot
    }
    
    Meal {
        ObjectId _id PK
        String name
        String type
        Boolean isActive
    }
    
    Addon {
        ObjectId _id PK
        String name
        Number price
        String type
        Boolean isActive
    }
    
    Order {
        ObjectId _id PK
        ObjectId userId FK
        String status
        String deliveryMode
        Date deliveryDate
        Array items
        Object pricing
        String paymentStatus
    }
    
    Payment {
        ObjectId _id PK
        String provider
        String type
        String status
        Number amount
        ObjectId userId FK
        ObjectId subscriptionId FK
        ObjectId orderId FK
        Boolean applied
    }
    
    SaladIngredient {
        ObjectId _id PK
        String name_en
        String name_ar
        Number price
        Number calories
        Number maxQuantity
        Boolean isActive
    }
    
    ActivityLog {
        ObjectId _id PK
        String entityType
        ObjectId entityId
        String action
        String byRole
        Object meta
    }
    
    NotificationLog {
        ObjectId _id PK
        ObjectId userId FK
        String title
        String body
        Boolean sent
    }
```

---

## API Route Hierarchy

```mermaid
graph LR
    Root["/api"] --> Auth["/auth"]
    Root --> Plans["/plans"]
    Root --> Subs["/subscriptions"]
    Root --> Orders["/orders"]
    Root --> Salads["/custom-salads"]
    Root --> Ingredients["/salad-ingredients"]
    Root --> Kitchen["/kitchen"]
    Root --> Courier["/courier"]
    Root --> Admin["/admin"]
    Root --> Webhooks["/webhooks"]
    Root --> Settings["/settings"]
    
    Auth --> OTPReq["/otp/request"]
    Auth --> OTPVer["/otp/verify"]
    Auth --> DevToken["/device-token"]
    
    Subs --> SubsPreview["/preview"]
    Subs --> SubsCheckout["/checkout"]
    Subs --> SubsDetail["/:id"]
    Subs --> SubsDays["/:id/days"]
    Subs --> SubsDaySkip["/:id/days/:date/skip"]
    Subs --> SubsPremium["/:id/premium/topup"]
    
    Orders --> OrdersCheckout["/checkout"]
    Orders --> OrdersDetail["/:id"]
    
    Kitchen --> KitchenDays["/days/:date"]
    Kitchen --> KitchenSubDays["/subscriptions/:id/days/:date/..."]
    Kitchen --> KitchenOrders["/orders/:date"]
    
    Admin --> AdminPlans["/plans"]
    Admin --> AdminUsers["/dashboard-users"]
    Admin --> AdminLogs["/logs"]
    Admin --> AdminSettings["/settings/..."]
    
    style Root fill:#e1f5ff
    style Auth fill:#fff4e1
    style Subs fill:#e8f5e9
    style Kitchen fill:#ffe1e1
    style Admin fill:#f3e5f5
```

---

## Technology Stack

```mermaid
graph TB
    subgraph "Frontend (Not in this repo)"
        MobileApp[Mobile App<br/>React Native / Flutter]
        DashboardApp[Dashboard<br/>React / Next.js]
    end
    
    subgraph "Backend Runtime"
        Node[Node.js 20+<br/>JavaScript Runtime]
        Express[Express 4.x<br/>Web Framework]
    end
    
    subgraph "Security & Auth"
        JWT[jsonwebtoken<br/>JWT for Mobile]
        BetterAuth[better-auth<br/>Dashboard Sessions]
        Helmet[helmet<br/>Security Headers]
        CORS[cors<br/>Cross-Origin]
        RateLimit[express-rate-limit<br/>Throttling]
    end
    
    subgraph "Database"
        MongoDB[MongoDB 7+<br/>NoSQL Database]
        Mongoose[Mongoose 8.x<br/>ODM]
    end
    
    subgraph "External Services"
        FirebaseAuth[Firebase Auth<br/>Phone OTP]
        FCM[Firebase Cloud Messaging<br/>Push Notifications]
        MoyasarPay[Moyasar<br/>Payment Gateway]
    end
    
    subgraph "Utilities"
        DateFns[date-fns & date-fns-tz<br/>KSA Timezone]
        Winston[winston<br/>Structured Logging]
        Swagger[swagger-ui-express<br/>API Docs]
        Dotenv[dotenv<br/>Config Management]
    end
    
    MobileApp -.->|HTTP/JSON| Express
    DashboardApp -.->|HTTP/JSON| Express
    
    Express --> JWT
    Express --> BetterAuth
    Express --> Helmet
    Express --> CORS
    Express --> RateLimit
    Express --> Mongoose
    Express --> Winston
    Express --> Swagger
    
    Mongoose --> MongoDB
    
    Express -.->|Verify Token| FirebaseAuth
    Express -.->|Send Push| FCM
    Express -.->|Payment URL| MoyasarPay
    MoyasarPay -.->|Webhook| Express
    
    Express --> DateFns
    Express --> Dotenv
    
    style Node fill:#90ee90
    style MongoDB fill:#4db33d
    style FirebaseAuth fill:#ffca28
    style MoyasarPay fill:#673ab7
```

---

## Deployment Architecture (Recommended)

```mermaid
graph TB
    subgraph "Internet"
        Clients[Clients<br/>Mobile & Web]
    end
    
    subgraph "Load Balancer / CDN"
        LB[Nginx / AWS ALB<br/>HTTPS/TLS Termination]
    end
    
    subgraph "Application Tier"
        API1[Node.js API<br/>Instance 1]
        API2[Node.js API<br/>Instance 2]
        API3[Node.js API<br/>Instance 3]
    end
    
    subgraph "Database Tier"
        Primary[(MongoDB<br/>Primary)]
        Secondary1[(MongoDB<br/>Secondary)]
        Secondary2[(MongoDB<br/>Secondary)]
    end
    
    subgraph "Caching Layer (Optional)"
        Redis[(Redis<br/>Session Store)]
    end
    
    subgraph "Background Jobs"
        Worker[Cron Worker<br/>Cutoff Job]
    end
    
    subgraph "External"
        S3[AWS S3<br/>Static Assets]
        CloudWatch[CloudWatch<br/>Logs & Monitoring]
    end
    
    Clients -->|HTTPS| LB
    LB --> API1
    LB --> API2
    LB --> API3
    
    API1 --> Primary
    API2 --> Primary
    API3 --> Primary
    
    Primary -.->|Replication| Secondary1
    Primary -.->|Replication| Secondary2
    
    API1 -.-> Redis
    API2 -.-> Redis
    API3 -.-> Redis
    
    Worker --> Primary
    
    API1 -.-> S3
    API1 -.-> CloudWatch
    
    style LB fill:#ff9800
    style Primary fill:#4caf50
    style Redis fill:#f44336
    style Worker fill:#9c27b0
```

---

This document provides comprehensive visual representations of the BasicDiet145 architecture, workflows, and data models.

For additional information, refer to the main `DOCUMENTATION.md` file.
