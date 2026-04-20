I/flutter (20829): onCreate -- TimelineBloc
I/flutter (20829): onChange -- TimelineBloc, Change { currentState: TimelineInitial(), nextState: TimelineLoading() }
W/WindowOnBackDispatcher(20829): OnBackInvokedCallback is not enabled for the application.
W/WindowOnBackDispatcher(20829): Set 'android:enableOnBackInvokedCallback="true"' in the application manifest.
I/flutter (20829):
I/flutter (20829): ╔╣ Request ║ GET
I/flutter (20829): ║  https://basicdiet145.onrender.com/api/subscriptions/69e4e3b9c0f16abfbabd92ac/timeline
I/flutter (20829): ╚══════════════════════════════════════════════════════════════════════════════════════════╝
I/flutter (20829): ╔ Headers
I/flutter (20829): ╟ accept: application/json
I/flutter (20829): ╟ content-type: application/json
I/flutter (20829): ╟ Authorization:
I/flutter (20829): ║ Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2OWNjOTYyNzYzMWU5YzFiMWRhODI1Yz
I/flutter (20829): ║ EiLCJyb2xlIjoiY2xpZW50IiwidG9rZW5UeXBlIjoiYXBwX2FjY2VzcyIsImlhdCI6MTc3NjI3NTIwOCwiZXhwIjox
I/flutter (20829): ║ Nzc4OTUzNjA4fQ.cur5pa8b7iZ0ApYKjVi60OuhoThcKMF7Xnn5syLXo0Y
I/flutter (20829): ╟ Accept-Language: ar
I/flutter (20829): ╟ contentType: application/json
I/flutter (20829): ╟ responseType: ResponseType.json
I/flutter (20829): ╟ followRedirects: true
I/flutter (20829): ╟ receiveTimeout: 16:40:00.000000
I/flutter (20829): ╚══════════════════════════════════════════════════════════════════════════════════════════╝
I/flutter (20829):
I/flutter (20829): ╔╣ Response ║ GET ║ Status: 200 OK  ║ Time: 809 ms
I/flutter (20829): ║  https://basicdiet145.onrender.com/api/subscriptions/69e4e3b9c0f16abfbabd92ac/timeline
I/flutter (20829): ╚══════════════════════════════════════════════════════════════════════════════════════════╝
I/flutter (20829): ╔ Headers
I/flutter (20829): ╟ x-dns-prefetch-control: [off]
I/flutter (20829): ╟ x-render-origin-server: [Render]
I/flutter (20829): ╟ date: [Mon, 20 Apr 2026 08:57:13 GMT]
I/flutter (20829): ╟ transfer-encoding: [chunked]
I/flutter (20829): ╟ origin-agent-cluster: [?1]
I/flutter (20829): ╟ vary: [Origin, Accept-Encoding]
I/flutter (20829): ╟ content-encoding: [gzip]
I/flutter (20829): ╟ server: [cloudflare]
I/flutter (20829): ╟ cross-origin-resource-policy: [same-origin]
I/flutter (20829): ╟ cf-ray: [9ef2f0b11f03e1a2-MRS]
I/flutter (20829): ╟ etag: [W/"7263-khVTdJE5hi0OIg7rmfKouZ3pEck"]
I/flutter (20829): ╟ x-frame-options: [SAMEORIGIN]
I/flutter (20829): ╟ content-security-policy:
I/flutter (20829): ║ [default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self';frame-
I/flutter (20829): ║ ancestors 'self';img-src 'self' data:;object-src 'none';script-src 'self';script-src-attr
I/flutter (20829): ║ 'none';style-src 'self' https: 'unsafe-inline';upgrade-insecure-requests]
I/flutter (20829): ╟ connection: [keep-alive]
I/flutter (20829): ╟ strict-transport-security: [max-age=15552000; includeSubDomains]
I/flutter (20829): ╟ referrer-policy: [no-referrer]
I/flutter (20829): ╟ cf-cache-status: [DYNAMIC]
I/flutter (20829): ╟ x-permitted-cross-domain-policies: [none]
I/flutter (20829): ╟ content-type: [application/json; charset=utf-8]
I/flutter (20829): ╟ cross-origin-opener-policy: [same-origin]
I/flutter (20829): ╟ rndr-id: [8006a55c-2af1-4e53]
I/flutter (20829): ╟ x-xss-protection: [0]
I/flutter (20829): ╟ access-control-allow-credentials: [true]
I/flutter (20829): ╟ alt-svc: [h3=":443"; ma=86400]
I/flutter (20829): ╟ x-download-options: [noopen]
I/flutter (20829): ╟ x-content-type-options: [nosniff]
I/flutter (20829): ╚══════════════════════════════════════════════════════════════════════════════════════════╝
I/flutter (20829): ╔ Body
I/flutter (20829): ║
I/flutter (20829): ║    {
I/flutter (20829): ║         "status": true,
I/flutter (20829): ║         "data": {
I/flutter (20829): ║             "subscriptionId": "69e4e3b9c0f16abfbabd92ac",
I/flutter (20829): ║             "dailyMealsRequired": 4,
I/flutter (20829): ║             "premiumMealsRemaining": 0,
I/flutter (20829): ║             "premiumMealsSelected": 0,
I/flutter (20829): ║             "premiumBalanceBreakdown": []
I/flutter (20829): ║             "days": [
I/flutter (20829): ║                {
I/flutter (20829): ║                     "date": "2026-04-20",
I/flutter (20829): ║                     "day": "الاثنين",
I/flutter (20829): ║                     "month": "أبريل",
I/flutter (20829): ║                     "dayNumber": 20,
I/flutter (20829): ║                     "status": "planned",
I/flutter (20829): ║                     "statusLabel": "مخطط له",
I/flutter (20829): ║                     "selectedMeals": 4,
I/flutter (20829): ║                     "requiredMeals": 4,
I/flutter (20829): ║                     "commercialState": "confirmed",
I/flutter (20829): ║                     "commercialStateLabel": "مؤكد",
I/flutter (20829): ║                     "isFulfillable": true,
I/flutter (20829): ║                     "canBePrepared": true,
I/flutter (20829): ║                     "paymentRequirement": {
I/flutter (20829): ║                         "status": "satisfied",
I/flutter (20829): ║                         "requiresPayment": false,
I/flutter (20829): ║                         "pricingStatus": "not_required",
I/flutter (20829): ║                         "blockingReason": null,
I/flutter (20829): ║                         "canCreatePayment": false,
I/flutter (20829): ║                         "premiumSelectedCount": 1,
I/flutter (20829): ║                         "premiumPendingPaymentCount": 0,
I/flutter (20829): ║                         "pendingAmountHalala": 0,
I/flutter (20829): ║                         "amountHalala": 0,
I/flutter (20829): ║                         "currency": "SAR",
I/flutter (20829): ║                         "pricingStatusLabel": "غير مطلوب",
I/flutter (20829): ║                         "blockingReasonLabel": null
I/flutter (20829): ║                    }
I/flutter (20829): ║                     "fulfillmentMode": "customer_selected",
I/flutter (20829): ║                     "consumptionState": "consumable_today",
I/flutter (20829): ║                     "requiredMealCount": 4,
I/flutter (20829): ║                     "specifiedMealCount": 4,
I/flutter (20829): ║                     "unspecifiedMealCount": 0,
I/flutter (20829): ║                     "hasCustomerSelections": true,
I/flutter (20829): ║                     "requiresMealTypeKnowledge": true,
I/flutter (20829): ║                     "planningReady": true,
I/flutter (20829): ║                     "fulfillmentReady": true,
I/flutter (20829): ║                     "selectedMealIds": []
I/flutter (20829): ║                     "mealSlots": [
I/flutter (20829): ║                        {
I/flutter (20829): ║                             "slotIndex": 1,
I/flutter (20829): ║                             "slotKey": "slot_1",
I/flutter (20829): ║                             "status": "complete",
I/flutter (20829): ║                             "proteinId": "69dfcca18ad797e60eed6126",
I/flutter (20829): ║                             "carbId": "69dfcca88ad797e60eed613c",
I/flutter (20829): ║                             "isPremium": false,
I/flutter (20829): ║                             "premiumSource": "none",
I/flutter (20829): ║                             "premiumExtraFeeHalala": 0
I/flutter (20829): ║                        },
I/flutter (20829): ║                        {
I/flutter (20829): ║                             "slotIndex": 2,
I/flutter (20829): ║                             "slotKey": "slot_2",
I/flutter (20829): ║                             "status": "complete",
I/flutter (20829): ║                             "proteinId": "69dfcca48ad797e60eed6130",
I/flutter (20829): ║                             "carbId": "69dfcca88ad797e60eed613d",
I/flutter (20829): ║                             "isPremium": false,
I/flutter (20829): ║                             "premiumSource": "none",
I/flutter (20829): ║                             "premiumExtraFeeHalala": 0
I/flutter (20829): ║                        },
I/flutter (20829): ║                        {
I/flutter (20829): ║                             "slotIndex": 3,
I/flutter (20829): ║                             "slotKey": "slot_3",
I/flutter (20829): ║                             "status": "complete",
I/flutter (20829): ║                             "proteinId": "69dfcca58ad797e60eed6134",
I/flutter (20829): ║                             "carbId": "69dfcca98ad797e60eed6142",
I/flutter (20829): ║                             "isPremium": false,
I/flutter (20829): ║                             "premiumSource": "none",
I/flutter (20829): ║                             "premiumExtraFeeHalala": 0
I/flutter (20829): ║                        },
I/flutter (20829): ║                        {
I/flutter (20829): ║                             "slotIndex": 4,
I/flutter (20829): ║                             "slotKey": "slot_4",
I/flutter (20829): ║                             "status": "complete",
I/flutter (20829): ║                             "proteinId": "69dfcca68ad797e60eed6138",
I/flutter (20829): ║                             "carbId": "69dfcca88ad797e60eed613e",
I/flutter (20829): ║                             "isPremium": true,
I/flutter (20829): ║                             "premiumSource": "paid_extra",
I/flutter (20829): ║                             "premiumExtraFeeHalala": 2000
I/flutter (20829): ║                        }
I/flutter (20829): ║                     ]
I/flutter (20829): ║                },
I/flutter (20829): ║                {
I/flutter (20829): ║                     "date": "2026-04-21",
I/flutter (20829): ║                     "day": "الثلاثاء",
I/flutter (20829): ║                     "month": "أبريل",
I/flutter (20829): ║                     "dayNumber": 21,
I/flutter (20829): ║                     "status": "planned",
I/flutter (20829): ║                     "statusLabel": "مخطط له",
I/flutter (20829): ║                     "selectedMeals": 4,
I/flutter (20829): ║                     "requiredMeals": 4,
I/flutter (20829): ║                     "commercialState": "confirmed",
I/flutter (20829): ║                     "commercialStateLabel": "مؤكد",
I/flutter (20829): ║                     "isFulfillable": true,
I/flutter (20829): ║                     "canBePrepared": true,
I/flutter (20829): ║                     "paymentRequirement": {
I/flutter (20829): ║                         "status": "satisfied",
I/flutter (20829): ║                         "requiresPayment": false,
I/flutter (20829): ║                         "pricingStatus": "not_required",
I/flutter (20829): ║                         "blockingReason": null,
I/flutter (20829): ║                         "canCreatePayment": false,
I/flutter (20829): ║                         "premiumSelectedCount": 1,
I/flutter (20829): ║                         "premiumPendingPaymentCount": 0,
I/flutter (20829): ║                         "pendingAmountHalala": 0,
I/flutter (20829): ║                         "amountHalala": 0,
I/flutter (20829): ║                         "currency": "SAR",
I/flutter (20829): ║                         "pricingStatusLabel": "غير مطلوب",
I/flutter (20829): ║                         "blockingReasonLabel": null
I/flutter (20829): ║                    }
I/flutter (20829): ║                     "fulfillmentMode": "customer_selected",
I/flutter (20829): ║                     "consumptionState": "pending_day",
I/flutter (20829): ║                     "requiredMealCount": 4,
I/flutter (20829): ║                     "specifiedMealCount": 4,
I/flutter (20829): ║                     "unspecifiedMealCount": 0,
I/flutter (20829): ║                     "hasCustomerSelections": true,
I/flutter (20829): ║                     "requiresMealTypeKnowledge": true,
I/flutter (20829): ║                     "planningReady": true,
I/flutter (20829): ║                     "fulfillmentReady": false,
I/flutter (20829): ║                     "selectedMealIds": []
I/flutter (20829): ║                     "mealSlots": [
I/flutter (20829): ║                        {
I/flutter (20829): ║                             "slotIndex": 1,
I/flutter (20829): ║                             "slotKey": "slot_1",
I/flutter (20829): ║                             "status": "complete",
I/flutter (20829): ║                             "proteinId": "69dfcca58ad797e60eed6134",
I/flutter (20829): ║                             "carbId": "69dfcca88ad797e60eed613e",
I/flutter (20829): ║                             "isPremium": false,
I/flutter (20829): ║                             "premiumSource": "none",
I/flutter (20829): ║                             "premiumExtraFeeHalala": 0
I/flutter (20829): ║                        },
I/flutter (20829): ║                        {
I/flutter (20829): ║                             "slotIndex": 2,
I/flutter (20829): ║                             "slotKey": "slot_2",
I/flutter (20829): ║                             "status": "complete",
I/flutter (20829): ║                             "proteinId": "69dfcca68ad797e60eed6138",
I/flutter (20829): ║                             "carbId": "69dfcca98ad797e60eed6142",
I/flutter (20829): ║                             "isPremium": true,
I/flutter (20829): ║                             "premiumSource": "paid_extra",
I/flutter (20829): ║                             "premiumExtraFeeHalala": 2000
I/flutter (20829): ║                        },
I/flutter (20829): ║                        {
I/flutter (20829): ║                             "slotIndex": 3,
I/flutter (20829): ║                             "slotKey": "slot_3",
I/flutter (20829): ║                             "status": "complete",
I/flutter (20829): ║                             "proteinId": "69dfcca18ad797e60eed6124",
I/flutter (20829): ║                             "carbId": "69dfcca88ad797e60eed613f",
I/flutter (20829): ║                             "isPremium": false,
I/flutter (20829): ║                             "premiumSource": "none",
I/flutter (20829): ║                             "premiumExtraFeeHalala": 0
I/flutter (20829): ║                        },
I/flutter (20829): ║                        {
I/flutter (20829): ║                             "slotIndex": 4,
I/flutter (20829): ║                             "slotKey": "slot_4",
I/flutter (20829): ║                             "status": "complete",
I/flutter (20829): ║                             "proteinId": "69dfcca18ad797e60eed6126",
I/flutter (20829): ║                             "carbId": "69dfcca78ad797e60eed613a",
I/flutter (20829): ║                             "isPremium": false,
I/flutter (20829): ║                             "premiumSource": "none",
I/flutter (20829): ║                             "premiumExtraFeeHalala": 0
I/flutter (20829): ║                        }
I/flutter (20829): ║                     ]
I/flutter (20829): ║                },
I/flutter (20829): ║                {
I/flutter (20829): ║                     "date": "2026-04-22",
I/flutter (20829): ║                     "day": "الأربعاء",
I/flutter (20829): ║                     "month": "أبريل",
I/flutter (20829): ║                     "dayNumber": 22,
I/flutter (20829): ║                     "status": "open",
I/flutter (20829): ║                     "statusLabel": "مفتوح",
I/flutter (20829): ║                     "selectedMeals": 0,
I/flutter (20829): ║                     "requiredMeals": 4,
I/flutter (20829): ║                     "commercialState": "draft",
I/flutter (20829): ║                     "commercialStateLabel": "مسودة",
I/flutter (20829): ║                     "isFulfillable": false,
I/flutter (20829): ║                     "canBePrepared": false,
I/flutter (20829): ║                     "paymentRequirement": {
I/flutter (20829): ║                         "status": "satisfied",
I/flutter (20829): ║                         "requiresPayment": false,
I/flutter (20829): ║                         "pricingStatus": "not_required",
I/flutter (20829): ║                         "blockingReason": "planning_incomplete",
I/flutter (20829): ║                         "canCreatePayment": false,
I/flutter (20829): ║                         "premiumSelectedCount": 0,
I/flutter (20829): ║                         "premiumPendingPaymentCount": 0,
I/flutter (20829): ║                         "pendingAmountHalala": 0,
I/flutter (20829): ║                         "amountHalala": 0,
I/flutter (20829): ║                         "currency": "SAR",
I/flutter (20829): ║                         "pricingStatusLabel": "غير مطلوب",
I/flutter (20829): ║                         "blockingReasonLabel": "التخطيط غير مكتمل"
I/flutter (20829): ║                    }
I/flutter (20829): ║                     "fulfillmentMode": "no_service",
I/flutter (20829): ║                     "consumptionState": "pending_day",
I/flutter (20829): ║                     "requiredMealCount": 4,
I/flutter (20829): ║                     "specifiedMealCount": 0,
I/flutter (20829): ║                     "unspecifiedMealCount": 4,
I/flutter (20829): ║                     "hasCustomerSelections": false,
I/flutter (20829): ║                     "requiresMealTypeKnowledge": false,
I/flutter (20829): ║                     "planningReady": false,
I/flutter (20829): ║                     "fulfillmentReady": false,
I/flutter (20829): ║                     "selectedMealIds": []
I/flutter (20829): ║                     "mealSlots": []
I/flutter (20829): ║                },
I/flutter (20829): ║                {
I/flutter (20829): ║                     "date": "2026-04-23",
I/flutter (20829): ║                     "day": "الخميس",
I/flutter (20829): ║                     "month": "أبريل",
I/flutter (20829): ║                     "dayNumber": 23,
I/flutter (20829): ║                     "status": "open",
I/flutter (20829): ║                     "statusLabel": "مفتوح",
I/flutter (20829): ║                     "selectedMeals": 0,
I/flutter (20829): ║                     "requiredMeals": 4,
I/flutter (20829): ║                     "commercialState": "draft",
I/flutter (20829): ║                     "commercialStateLabel": "مسودة",
I/flutter (20829): ║                     "isFulfillable": false,
I/flutter (20829): ║                     "canBePrepared": false,
I/flutter (20829): ║                     "paymentRequirement": {
I/flutter (20829): ║                         "status": "satisfied",
I/flutter (20829): ║                         "requiresPayment": false,
I/flutter (20829): ║                         "pricingStatus": "not_required",
I/flutter (20829): ║                         "blockingReason": "planning_incomplete",
I/flutter (20829): ║                         "canCreatePayment": false,
I/flutter (20829): ║                         "premiumSelectedCount": 0,
I/flutter (20829): ║                         "premiumPendingPaymentCount": 0,
I/flutter (20829): ║                         "pendingAmountHalala": 0,
I/flutter (20829): ║                         "amountHalala": 0,
I/flutter (20829): ║                         "currency": "SAR",
I/flutter (20829): ║                         "pricingStatusLabel": "غير مطلوب",
I/flutter (20829): ║                         "blockingReasonLabel": "التخطيط غير مكتمل"
I/flutter (20829): ║                    }
I/flutter (20829): ║                     "fulfillmentMode": "no_service",
I/flutter (20829): ║                     "consumptionState": "pending_day",
I/flutter (20829): ║                     "requiredMealCount": 4,
I/flutter (20829): ║                     "specifiedMealCount": 0,
I/flutter (20829): ║                     "unspecifiedMealCount": 4,
I/flutter (20829): ║                     "hasCustomerSelections": false,
I/flutter (20829): ║                     "requiresMealTypeKnowledge": false,
I/flutter (20829): ║                     "planningReady": false,
I/flutter (20829): ║                     "fulfillmentReady": false,
I/flutter (20829): ║                     "selectedMealIds": []
I/flutter (20829): ║                     "mealSlots": []
I/flutter (20829): ║                },
I/flutter (20829): ║                {
I/flutter (20829): ║                     "date": "2026-04-24",
I/flutter (20829): ║                     "day": "الجمعة",
I/flutter (20829): ║                     "month": "أبريل",
I/flutter (20829): ║                     "dayNumber": 24,
I/flutter (20829): ║                     "status": "open",
I/flutter (20829): ║                     "statusLabel": "مفتوح",
I/flutter (20829): ║                     "selectedMeals": 0,
I/flutter (20829): ║                     "requiredMeals": 4,
I/flutter (20829): ║                     "commercialState": "draft",
I/flutter (20829): ║                     "commercialStateLabel": "مسودة",
I/flutter (20829): ║                     "isFulfillable": false,
I/flutter (20829): ║                     "canBePrepared": false,
I/flutter (20829): ║                     "paymentRequirement": {
I/flutter (20829): ║                         "status": "satisfied",
I/flutter (20829): ║                         "requiresPayment": false,
I/flutter (20829): ║                         "pricingStatus": "not_required",
I/flutter (20829): ║                         "blockingReason": "planning_incomplete",
I/flutter (20829): ║                         "canCreatePayment": false,
I/flutter (20829): ║                         "premiumSelectedCount": 0,
I/flutter (20829): ║                         "premiumPendingPaymentCount": 0,
I/flutter (20829): ║                         "pendingAmountHalala": 0,
I/flutter (20829): ║                         "amountHalala": 0,
I/flutter (20829): ║                         "currency": "SAR",
I/flutter (20829): ║                         "pricingStatusLabel": "غير مطلوب",
I/flutter (20829): ║                         "blockingReasonLabel": "التخطيط غير مكتمل"
I/flutter (20829): ║                    }
I/flutter (20829): ║                     "fulfillmentMode": "no_service",
I/flutter (20829): ║                     "consumptionState": "pending_day",
I/flutter (20829): ║                     "requiredMealCount": 4,
I/flutter (20829): ║                     "specifiedMealCount": 0,
I/flutter (20829): ║                     "unspecifiedMealCount": 4,
I/flutter (20829): ║                     "hasCustomerSelections": false,
I/flutter (20829): ║                     "requiresMealTypeKnowledge": false,
I/flutter (20829): ║                     "planningReady": false,
I/flutter (20829): ║                     "fulfillmentReady": false,
I/flutter (20829): ║                     "selectedMealIds": []
I/flutter (20829): ║                     "mealSlots": []
I/flutter (20829): ║                },
I/flutter (20829): ║                {
I/flutter (20829): ║                     "date": "2026-04-25",
I/flutter (20829): ║                     "day": "السبت",
I/flutter (20829): ║                     "month": "أبريل",
I/flutter (20829): ║                     "dayNumber": 25,
I/flutter (20829): ║                     "status": "open",
I/flutter (20829): ║                     "statusLabel": "مفتوح",
I/flutter (20829): ║                     "selectedMeals": 0,
I/flutter (20829): ║                     "requiredMeals": 4,
I/flutter (20829): ║                     "commercialState": "draft",
I/flutter (20829): ║                     "commercialStateLabel": "مسودة",
I/flutter (20829): ║                     "isFulfillable": false,
I/flutter (20829): ║                     "canBePrepared": false,
I/flutter (20829): ║                     "paymentRequirement": {
I/flutter (20829): ║                         "status": "satisfied",
I/flutter (20829): ║                         "requiresPayment": false,
I/flutter (20829): ║                         "pricingStatus": "not_required",
I/flutter (20829): ║                         "blockingReason": "planning_incomplete",
I/flutter (20829): ║                         "canCreatePayment": false,
I/flutter (20829): ║                         "premiumSelectedCount": 0,
I/flutter (20829): ║                         "premiumPendingPaymentCount": 0,
I/flutter (20829): ║                         "pendingAmountHalala": 0,
I/flutter (20829): ║                         "amountHalala": 0,
I/flutter (20829): ║                         "currency": "SAR",
I/flutter (20829): ║                         "pricingStatusLabel": "غير مطلوب",
I/flutter (20829): ║                         "blockingReasonLabel": "التخطيط غير مكتمل"
I/flutter (20829): ║                    }
I/flutter (20829): ║                     "fulfillmentMode": "no_service",
I/flutter (20829): ║                     "consumptionState": "pending_day",
I/flutter (20829): ║                     "requiredMealCount": 4,
I/flutter (20829): ║                     "specifiedMealCount": 0,
I/flutter (20829): ║                     "unspecifiedMealCount": 4,
I/flutter (20829): ║                     "hasCustomerSelections": false,
I/flutter (20829): ║                     "requiresMealTypeKnowledge": false,
I/flutter (20829): ║                     "planningReady": false,
I/flutter (20829): ║                     "fulfillmentReady": false,
I/flutter (20829): ║                     "selectedMealIds": []
I/flutter (20829): ║                     "mealSlots": []
I/flutter (20829): ║                },
I/flutter (20829): ║                {
I/flutter (20829): ║                     "date": "2026-04-26",
I/flutter (20829): ║                     "day": "الأحد",
I/flutter (20829): ║                     "month": "أبريل",
I/flutter (20829): ║                     "dayNumber": 26,
I/flutter (20829): ║                     "status": "open",
I/flutter (20829): ║                     "statusLabel": "مفتوح",
I/flutter (20829): ║                     "selectedMeals": 0,
I/flutter (20829): ║                     "requiredMeals": 4,
I/flutter (20829): ║                     "commercialState": "draft",
I/flutter (20829): ║                     "commercialStateLabel": "مسودة",
I/flutter (20829): ║                     "isFulfillable": false,
I/flutter (20829): ║                     "canBePrepared": false,
I/flutter (20829): ║                     "paymentRequirement": {
I/flutter (20829): ║                         "status": "satisfied",
I/flutter (20829): ║                         "requiresPayment": false,
I/flutter (20829): ║                         "pricingStatus": "not_required",
I/flutter (20829): ║                         "blockingReason": "planning_incomplete",
I/flutter (20829): ║                         "canCreatePayment": false,
I/flutter (20829): ║                         "premiumSelectedCount": 0,
I/flutter (20829): ║                         "premiumPendingPaymentCount": 0,
I/flutter (20829): ║                         "pendingAmountHalala": 0,
I/flutter (20829): ║                         "amountHalala": 0,
I/flutter (20829): ║                         "currency": "SAR",
I/flutter (20829): ║                         "pricingStatusLabel": "غير مطلوب",
I/flutter (20829): ║                         "blockingReasonLabel": "التخطيط غير مكتمل"
I/flutter (20829): ║                    }
I/flutter (20829): ║                     "fulfillmentMode": "no_service",
I/flutter (20829): ║                     "consumptionState": "pending_day",
I/flutter (20829): ║                     "requiredMealCount": 4,
I/flutter (20829): ║                     "specifiedMealCount": 0,
I/flutter (20829): ║                     "unspecifiedMealCount": 4,
I/flutter (20829): ║                     "hasCustomerSelections": false,
I/flutter (20829): ║                     "requiresMealTypeKnowledge": false,
I/flutter (20829): ║                     "planningReady": false,
I/flutter (20829): ║                     "fulfillmentReady": false,
I/flutter (20829): ║                     "selectedMealIds": []
I/flutter (20829): ║                     "mealSlots": []
I/flutter (20829): ║                },
I/flutter (20829): ║                {
I/flutter (20829): ║                     "date": "2026-04-27",
I/flutter (20829): ║                     "day": "الاثنين",
I/flutter (20829): ║                     "month": "أبريل",
I/flutter (20829): ║                     "dayNumber": 27,
I/flutter (20829): ║                     "status": "open",
I/flutter (20829): ║                     "statusLabel": "مفتوح",
I/flutter (20829): ║                     "selectedMeals": 0,
I/flutter (20829): ║                     "requiredMeals": 4,
I/flutter (20829): ║                     "commercialState": "draft",
I/flutter (20829): ║                     "commercialStateLabel": "مسودة",
I/flutter (20829): ║                     "isFulfillable": false,
I/flutter (20829): ║                     "canBePrepared": false,
I/flutter (20829): ║                     "paymentRequirement": {
I/flutter (20829): ║                         "status": "satisfied",
I/flutter (20829): ║                         "requiresPayment": false,
I/flutter (20829): ║                         "pricingStatus": "not_required",
I/flutter (20829): ║                         "blockingReason": "planning_incomplete",
I/flutter (20829): ║                         "canCreatePayment": false,
I/flutter (20829): ║                         "premiumSelectedCount": 0,
I/flutter (20829): ║                         "premiumPendingPaymentCount": 0,
I/flutter (20829): ║                         "pendingAmountHalala": 0,
I/flutter (20829): ║                         "amountHalala": 0,
I/flutter (20829): ║                         "currency": "SAR",
I/flutter (20829): ║                         "pricingStatusLabel": "غير مطلوب",
I/flutter (20829): ║                         "blockingReasonLabel": "التخطيط غير مكتمل"
I/flutter (20829): ║                    }
I/flutter (20829): ║                     "fulfillmentMode": "no_service",
I/flutter (20829): ║                     "consumptionState": "pending_day",
I/flutter (20829): ║                     "requiredMealCount": 4,
I/flutter (20829): ║                     "specifiedMealCount": 0,
I/flutter (20829): ║                     "unspecifiedMealCount": 4,
I/flutter (20829): ║                     "hasCustomerSelections": false,
I/flutter (20829): ║                     "requiresMealTypeKnowledge": false,
I/flutter (20829): ║                     "planningReady": false,
I/flutter (20829): ║                     "fulfillmentReady": false,
I/flutter (20829): ║                     "selectedMealIds": []
I/flutter (20829): ║                     "mealSlots": []
I/flutter (20829): ║                },
I/flutter (20829): ║                {
I/flutter (20829): ║                     "date": "2026-04-28",
I/flutter (20829): ║                     "day": "الثلاثاء",
I/flutter (20829): ║                     "month": "أبريل",
I/flutter (20829): ║                     "dayNumber": 28,
I/flutter (20829): ║                     "status": "open",
I/flutter (20829): ║                     "statusLabel": "مفتوح",
I/flutter (20829): ║                     "selectedMeals": 0,
I/flutter (20829): ║                     "requiredMeals": 4,
I/flutter (20829): ║                     "commercialState": "draft",
I/flutter (20829): ║                     "commercialStateLabel": "مسودة",
I/flutter (20829): ║                     "isFulfillable": false,
I/flutter (20829): ║                     "canBePrepared": false,
I/flutter (20829): ║                     "paymentRequirement": {
I/flutter (20829): ║                         "status": "satisfied",
I/flutter (20829): ║                         "requiresPayment": false,
I/flutter (20829): ║                         "pricingStatus": "not_required",
I/flutter (20829): ║                         "blockingReason": "planning_incomplete",
I/flutter (20829): ║                         "canCreatePayment": false,
I/flutter (20829): ║                         "premiumSelectedCount": 0,
I/flutter (20829): ║                         "premiumPendingPaymentCount": 0,
I/flutter (20829): ║                         "pendingAmountHalala": 0,
I/flutter (20829): ║                         "amountHalala": 0,
I/flutter (20829): ║                         "currency": "SAR",
I/flutter (20829): ║                         "pricingStatusLabel": "غير مطلوب",
I/flutter (20829): ║                         "blockingReasonLabel": "التخطيط غير مكتمل"
I/flutter (20829): ║                    }
I/flutter (20829): ║                     "fulfillmentMode": "no_service",
I/flutter (20829): ║                     "consumptionState": "pending_day",
I/flutter (20829): ║                     "requiredMealCount": 4,
I/flutter (20829): ║                     "specifiedMealCount": 0,
I/flutter (20829): ║                     "unspecifiedMealCount": 4,
I/flutter (20829): ║                     "hasCustomerSelections": false,
I/flutter (20829): ║                     "requiresMealTypeKnowledge": false,
I/flutter (20829): ║                     "planningReady": false,
I/flutter (20829): ║                     "fulfillmentReady": false,
I/flutter (20829): ║                     "selectedMealIds": []
I/flutter (20829): ║                     "mealSlots": []
I/flutter (20829): ║                },
I/flutter (20829): ║                {
I/flutter (20829): ║                     "date": "2026-04-29",
I/flutter (20829): ║                     "day": "الأربعاء",
I/flutter (20829): ║                     "month": "أبريل",
I/flutter (20829): ║                     "dayNumber": 29,
I/flutter (20829): ║                     "status": "open",
I/flutter (20829): ║                     "statusLabel": "مفتوح",
I/flutter (20829): ║                     "selectedMeals": 0,
I/flutter (20829): ║                     "requiredMeals": 4,
I/flutter (20829): ║                     "commercialState": "draft",
I/flutter (20829): ║                     "commercialStateLabel": "مسودة",
I/flutter (20829): ║                     "isFulfillable": false,
I/flutter (20829): ║                     "canBePrepared": false,
I/flutter (20829): ║                     "paymentRequirement": {
I/flutter (20829): ║                         "status": "satisfied",
I/flutter (20829): ║                         "requiresPayment": false,
I/flutter (20829): ║                         "pricingStatus": "not_required",
I/flutter (20829): ║                         "blockingReason": "planning_incomplete",
I/flutter (20829): ║                         "canCreatePayment": false,
I/flutter (20829): ║                         "premiumSelectedCount": 0,
I/flutter (20829): ║                         "premiumPendingPaymentCount": 0,
I/flutter (20829): ║                         "pendingAmountHalala": 0,
I/flutter (20829): ║                         "amountHalala": 0,
I/flutter (20829): ║                         "currency": "SAR",
I/flutter (20829): ║                         "pricingStatusLabel": "غير مطلوب",
I/flutter (20829): ║                         "blockingReasonLabel": "التخطيط غير مكتمل"
I/flutter (20829): ║                    }
I/flutter (20829): ║                     "fulfillmentMode": "no_service",
I/flutter (20829): ║                     "consumptionState": "pending_day",
I/flutter (20829): ║                     "requiredMealCount": 4,
I/flutter (20829): ║                     "specifiedMealCount": 0,
I/flutter (20829): ║                     "unspecifiedMealCount": 4,
I/flutter (20829): ║                     "hasCustomerSelections": false,
I/flutter (20829): ║                     "requiresMealTypeKnowledge": false,
I/flutter (20829): ║                     "planningReady": false,
I/flutter (20829): ║                     "fulfillmentReady": false,
I/flutter (20829): ║                     "selectedMealIds": []
I/flutter (20829): ║                     "mealSlots": []
I/flutter (20829): ║                },
I/flutter (20829): ║                {
I/flutter (20829): ║                     "date": "2026-04-30",
I/flutter (20829): ║                     "day": "الخميس",
I/flutter (20829): ║                     "month": "أبريل",
I/flutter (20829): ║                     "dayNumber": 30,
I/flutter (20829): ║                     "status": "open",
I/flutter (20829): ║                     "statusLabel": "مفتوح",
I/flutter (20829): ║                     "selectedMeals": 0,
I/flutter (20829): ║                     "requiredMeals": 4,
I/flutter (20829): ║                     "commercialState": "draft",
I/flutter (20829): ║                     "commercialStateLabel": "مسودة",
I/flutter (20829): ║                     "isFulfillable": false,
I/flutter (20829): ║                     "canBePrepared": false,
I/flutter (20829): ║                     "paymentRequirement": {
I/flutter (20829): ║                         "status": "satisfied",
I/flutter (20829): ║                         "requiresPayment": false,
I/flutter (20829): ║                         "pricingStatus": "not_required",
I/flutter (20829): ║                         "blockingReason": "planning_incomplete",
I/flutter (20829): ║                         "canCreatePayment": false,
I/flutter (20829): ║                         "premiumSelectedCount": 0,
I/flutter (20829): ║                         "premiumPendingPaymentCount": 0,
I/flutter (20829): ║                         "pendingAmountHalala": 0,
I/flutter (20829): ║                         "amountHalala": 0,
I/flutter (20829): ║                         "currency": "SAR",
I/flutter (20829): ║                         "pricingStatusLabel": "غير مطلوب",
I/flutter (20829): ║                         "blockingReasonLabel": "التخطيط غير مكتمل"
I/flutter (20829): ║                    }
I/flutter (20829): ║                     "fulfillmentMode": "no_service",
I/flutter (20829): ║                     "consumptionState": "pending_day",
I/flutter (20829): ║                     "requiredMealCount": 4,
I/flutter (20829): ║                     "specifiedMealCount": 0,
I/flutter (20829): ║                     "unspecifiedMealCount": 4,
I/flutter (20829): ║                     "hasCustomerSelections": false,
I/flutter (20829): ║                     "requiresMealTypeKnowledge": false,
I/flutter (20829): ║                     "planningReady": false,
I/flutter (20829): ║                     "fulfillmentReady": false,
I/flutter (20829): ║                     "selectedMealIds": []
I/flutter (20829): ║                     "mealSlots": []
I/flutter (20829): ║                },
I/flutter (20829): ║                {
I/flutter (20829): ║                     "date": "2026-05-01",
I/flutter (20829): ║                     "day": "الجمعة",
I/flutter (20829): ║                     "month": "مايو",
I/flutter (20829): ║                     "dayNumber": 1,
I/flutter (20829): ║                     "status": "open",
I/flutter (20829): ║                     "statusLabel": "مفتوح",
I/flutter (20829): ║                     "selectedMeals": 0,
I/flutter (20829): ║                     "requiredMeals": 4,
I/flutter (20829): ║                     "commercialState": "draft",
I/flutter (20829): ║                     "commercialStateLabel": "مسودة",
I/flutter (20829): ║                     "isFulfillable": false,
I/flutter (20829): ║                     "canBePrepared": false,
I/flutter (20829): ║                     "paymentRequirement": {
I/flutter (20829): ║                         "status": "satisfied",
I/flutter (20829): ║                         "requiresPayment": false,
I/flutter (20829): ║                         "pricingStatus": "not_required",
I/flutter (20829): ║                         "blockingReason": "planning_incomplete",
I/flutter (20829): ║                         "canCreatePayment": false,
I/flutter (20829): ║                         "premiumSelectedCount": 0,
I/flutter (20829): ║                         "premiumPendingPaymentCount": 0,
I/flutter (20829): ║                         "pendingAmountHalala": 0,
I/flutter (20829): ║                         "amountHalala": 0,
I/flutter (20829): ║                         "currency": "SAR",
I/flutter (20829): ║                         "pricingStatusLabel": "غير مطلوب",
I/flutter (20829): ║                         "blockingReasonLabel": "التخطيط غير مكتمل"
I/flutter (20829): ║                    }
I/flutter (20829): ║                     "fulfillmentMode": "no_service",
I/flutter (20829): ║                     "consumptionState": "pending_day",
I/flutter (20829): ║                     "requiredMealCount": 4,
I/flutter (20829): ║                     "specifiedMealCount": 0,
I/flutter (20829): ║                     "unspecifiedMealCount": 4,
I/flutter (20829): ║                     "hasCustomerSelections": false,
I/flutter (20829): ║                     "requiresMealTypeKnowledge": false,
I/flutter (20829): ║                     "planningReady": false,
I/flutter (20829): ║                     "fulfillmentReady": false,
I/flutter (20829): ║                     "selectedMealIds": []
I/flutter (20829): ║                     "mealSlots": []
I/flutter (20829): ║                },
I/flutter (20829): ║                {
I/flutter (20829): ║                     "date": "2026-05-02",
I/flutter (20829): ║                     "day": "السبت",
I/flutter (20829): ║                     "month": "مايو",
I/flutter (20829): ║                     "dayNumber": 2,
I/flutter (20829): ║                     "status": "open",
I/flutter (20829): ║                     "statusLabel": "مفتوح",
I/flutter (20829): ║                     "selectedMeals": 0,
I/flutter (20829): ║                     "requiredMeals": 4,
I/flutter (20829): ║                     "commercialState": "draft",
I/flutter (20829): ║                     "commercialStateLabel": "مسودة",
I/flutter (20829): ║                     "isFulfillable": false,
I/flutter (20829): ║                     "canBePrepared": false,
I/flutter (20829): ║                     "paymentRequirement": {
I/flutter (20829): ║                         "status": "satisfied",
I/flutter (20829): ║                         "requiresPayment": false,
I/flutter (20829): ║                         "pricingStatus": "not_required",
I/flutter (20829): ║                         "blockingReason": "planning_incomplete",
I/flutter (20829): ║                         "canCreatePayment": false,
I/flutter (20829): ║                         "premiumSelectedCount": 0,
I/flutter (20829): ║                         "premiumPendingPaymentCount": 0,
I/flutter (20829): ║                         "pendingAmountHalala": 0,
I/flutter (20829): ║                         "amountHalala": 0,
I/flutter (20829): ║                         "currency": "SAR",
I/flutter (20829): ║                         "pricingStatusLabel": "غير مطلوب",
I/flutter (20829): ║                         "blockingReasonLabel": "التخطيط غير مكتمل"
I/flutter (20829): ║                    }
I/flutter (20829): ║                     "fulfillmentMode": "no_service",
I/flutter (20829): ║                     "consumptionState": "pending_day",
I/flutter (20829): ║                     "requiredMealCount": 4,
I/flutter (20829): ║                     "specifiedMealCount": 0,
I/flutter (20829): ║                     "unspecifiedMealCount": 4,
I/flutter (20829): ║                     "hasCustomerSelections": false,
I/flutter (20829): ║                     "requiresMealTypeKnowledge": false,
I/flutter (20829): ║                     "planningReady": false,
I/flutter (20829): ║                     "fulfillmentReady": false,
I/flutter (20829): ║                     "selectedMealIds": []
I/flutter (20829): ║                     "mealSlots": []
I/flutter (20829): ║                },
I/flutter (20829): ║                {
I/flutter (20829): ║                     "date": "2026-05-03",
I/flutter (20829): ║                     "day": "الأحد",
I/flutter (20829): ║                     "month": "مايو",
I/flutter (20829): ║                     "dayNumber": 3,
I/flutter (20829): ║                     "status": "open",
I/flutter (20829): ║                     "statusLabel": "مفتوح",
I/flutter (20829): ║                     "selectedMeals": 0,
I/flutter (20829): ║                     "requiredMeals": 4,
I/flutter (20829): ║                     "commercialState": "draft",
I/flutter (20829): ║                     "commercialStateLabel": "مسودة",
I/flutter (20829): ║                     "isFulfillable": false,
I/flutter (20829): ║                     "canBePrepared": false,
I/flutter (20829): ║                     "paymentRequirement": {
I/flutter (20829): ║                         "status": "satisfied",
I/flutter (20829): ║                         "requiresPayment": false,
I/flutter (20829): ║                         "pricingStatus": "not_required",
I/flutter (20829): ║                         "blockingReason": "planning_incomplete",
I/flutter (20829): ║                         "canCreatePayment": false,
I/flutter (20829): ║                         "premiumSelectedCount": 0,
I/flutter (20829): ║                         "premiumPendingPaymentCount": 0,
I/flutter (20829): ║                         "pendingAmountHalala": 0,
I/flutter (20829): ║                         "amountHalala": 0,
I/flutter (20829): ║                         "currency": "SAR",
I/flutter (20829): ║                         "pricingStatusLabel": "غير مطلوب",
I/flutter (20829): ║                         "blockingReasonLabel": "التخطيط غير مكتمل"
I/flutter (20829): ║                    }
I/flutter (20829): ║                     "fulfillmentMode": "no_service",
I/flutter (20829): ║                     "consumptionState": "pending_day",
I/flutter (20829): ║                     "requiredMealCount": 4,
I/flutter (20829): ║                     "specifiedMealCount": 0,
I/flutter (20829): ║                     "unspecifiedMealCount": 4,
I/flutter (20829): ║                     "hasCustomerSelections": false,
I/flutter (20829): ║                     "requiresMealTypeKnowledge": false,
I/flutter (20829): ║                     "planningReady": false,
I/flutter (20829): ║                     "fulfillmentReady": false,
I/flutter (20829): ║                     "selectedMealIds": []
I/flutter (20829): ║                     "mealSlots": []
I/flutter (20829): ║                },
I/flutter (20829): ║                {
I/flutter (20829): ║                     "date": "2026-05-04",
I/flutter (20829): ║                     "day": "الاثنين",
I/flutter (20829): ║                     "month": "مايو",
I/flutter (20829): ║                     "dayNumber": 4,
I/flutter (20829): ║                     "status": "open",
I/flutter (20829): ║                     "statusLabel": "مفتوح",
I/flutter (20829): ║                     "selectedMeals": 0,
I/flutter (20829): ║                     "requiredMeals": 4,
I/flutter (20829): ║                     "commercialState": "draft",
I/flutter (20829): ║                     "commercialStateLabel": "مسودة",
I/flutter (20829): ║                     "isFulfillable": false,
I/flutter (20829): ║                     "canBePrepared": false,
I/flutter (20829): ║                     "paymentRequirement": {
I/flutter (20829): ║                         "status": "satisfied",
I/flutter (20829): ║                         "requiresPayment": false,
I/flutter (20829): ║                         "pricingStatus": "not_required",
I/flutter (20829): ║                         "blockingReason": "planning_incomplete",
I/flutter (20829): ║                         "canCreatePayment": false,
I/flutter (20829): ║                         "premiumSelectedCount": 0,
I/flutter (20829): ║                         "premiumPendingPaymentCount": 0,
I/flutter (20829): ║                         "pendingAmountHalala": 0,
I/flutter (20829): ║                         "amountHalala": 0,
I/flutter (20829): ║                         "currency": "SAR",
I/flutter (20829): ║                         "pricingStatusLabel": "غير مطلوب",
I/flutter (20829): ║                         "blockingReasonLabel": "التخطيط غير مكتمل"
I/flutter (20829): ║                    }
I/flutter (20829): ║                     "fulfillmentMode": "no_service",
I/flutter (20829): ║                     "consumptionState": "pending_day",
I/flutter (20829): ║                     "requiredMealCount": 4,
I/flutter (20829): ║                     "specifiedMealCount": 0,
I/flutter (20829): ║                     "unspecifiedMealCount": 4,
I/flutter (20829): ║                     "hasCustomerSelections": false,
I/flutter (20829): ║                     "requiresMealTypeKnowledge": false,
I/flutter (20829): ║                     "planningReady": false,
I/flutter (20829): ║                     "fulfillmentReady": false,
I/flutter (20829): ║                     "selectedMealIds": []
I/flutter (20829): ║                     "mealSlots": []
I/flutter (20829): ║                },
I/flutter (20829): ║                {
I/flutter (20829): ║                     "date": "2026-05-05",
I/flutter (20829): ║                     "day": "الثلاثاء",
I/flutter (20829): ║                     "month": "مايو",
I/flutter (20829): ║                     "dayNumber": 5,
I/flutter (20829): ║                     "status": "open",
I/flutter (20829): ║                     "statusLabel": "مفتوح",
I/flutter (20829): ║                     "selectedMeals": 0,
I/flutter (20829): ║                     "requiredMeals": 4,
I/flutter (20829): ║                     "commercialState": "draft",
I/flutter (20829): ║                     "commercialStateLabel": "مسودة",
I/flutter (20829): ║                     "isFulfillable": false,
I/flutter (20829): ║                     "canBePrepared": false,
I/flutter (20829): ║                     "paymentRequirement": {
I/flutter (20829): ║                         "status": "satisfied",
I/flutter (20829): ║                         "requiresPayment": false,
I/flutter (20829): ║                         "pricingStatus": "not_required",
I/flutter (20829): ║                         "blockingReason": "planning_incomplete",
I/flutter (20829): ║                         "canCreatePayment": false,
I/flutter (20829): ║                         "premiumSelectedCount": 0,
I/flutter (20829): ║                         "premiumPendingPaymentCount": 0,
I/flutter (20829): ║                         "pendingAmountHalala": 0,
I/flutter (20829): ║                         "amountHalala": 0,
I/flutter (20829): ║                         "currency": "SAR",
I/flutter (20829): ║                         "pricingStatusLabel": "غير مطلوب",
I/flutter (20829): ║                         "blockingReasonLabel": "التخطيط غير مكتمل"
I/flutter (20829): ║                    }
I/flutter (20829): ║                     "fulfillmentMode": "no_service",
I/flutter (20829): ║                     "consumptionState": "pending_day",
I/flutter (20829): ║                     "requiredMealCount": 4,
I/flutter (20829): ║                     "specifiedMealCount": 0,
I/flutter (20829): ║                     "unspecifiedMealCount": 4,
I/flutter (20829): ║                     "hasCustomerSelections": false,
I/flutter (20829): ║                     "requiresMealTypeKnowledge": false,
I/flutter (20829): ║                     "planningReady": false,
I/flutter (20829): ║                     "fulfillmentReady": false,
I/flutter (20829): ║                     "selectedMealIds": []
I/flutter (20829): ║                     "mealSlots": []
I/flutter (20829): ║                },
I/flutter (20829): ║                {
I/flutter (20829): ║                     "date": "2026-05-06",
I/flutter (20829): ║                     "day": "الأربعاء",
I/flutter (20829): ║                     "month": "مايو",
I/flutter (20829): ║                     "dayNumber": 6,
I/flutter (20829): ║                     "status": "open",
I/flutter (20829): ║                     "statusLabel": "مفتوح",
I/flutter (20829): ║                     "selectedMeals": 0,
I/flutter (20829): ║                     "requiredMeals": 4,
I/flutter (20829): ║                     "commercialState": "draft",
I/flutter (20829): ║                     "commercialStateLabel": "مسودة",
I/flutter (20829): ║                     "isFulfillable": false,
I/flutter (20829): ║                     "canBePrepared": false,
I/flutter (20829): ║                     "paymentRequirement": {
I/flutter (20829): ║                         "status": "satisfied",
I/flutter (20829): ║                         "requiresPayment": false,
I/flutter (20829): ║                         "pricingStatus": "not_required",
I/flutter (20829): ║                         "blockingReason": "planning_incomplete",
I/flutter (20829): ║                         "canCreatePayment": false,
I/flutter (20829): ║                         "premiumSelectedCount": 0,
I/flutter (20829): ║                         "premiumPendingPaymentCount": 0,
I/flutter (20829): ║                         "pendingAmountHalala": 0,
I/flutter (20829): ║                         "amountHalala": 0,
I/flutter (20829): ║                         "currency": "SAR",
I/flutter (20829): ║                         "pricingStatusLabel": "غير مطلوب",
I/flutter (20829): ║                         "blockingReasonLabel": "التخطيط غير مكتمل"
I/flutter (20829): ║                    }
I/flutter (20829): ║                     "fulfillmentMode": "no_service",
I/flutter (20829): ║                     "consumptionState": "pending_day",
I/flutter (20829): ║                     "requiredMealCount": 4,
I/flutter (20829): ║                     "specifiedMealCount": 0,
I/flutter (20829): ║                     "unspecifiedMealCount": 4,
I/flutter (20829): ║                     "hasCustomerSelections": false,
I/flutter (20829): ║                     "requiresMealTypeKnowledge": false,
I/flutter (20829): ║                     "planningReady": false,
I/flutter (20829): ║                     "fulfillmentReady": false,
I/flutter (20829): ║                     "selectedMealIds": []
I/flutter (20829): ║                     "mealSlots": []
I/flutter (20829): ║                },
I/flutter (20829): ║                {
I/flutter (20829): ║                     "date": "2026-05-07",
I/flutter (20829): ║                     "day": "الخميس",
I/flutter (20829): ║                     "month": "مايو",
I/flutter (20829): ║                     "dayNumber": 7,
I/flutter (20829): ║                     "status": "open",
I/flutter (20829): ║                     "statusLabel": "مفتوح",
I/flutter (20829): ║                     "selectedMeals": 0,
I/flutter (20829): ║                     "requiredMeals": 4,
I/flutter (20829): ║                     "commercialState": "draft",
I/flutter (20829): ║                     "commercialStateLabel": "مسودة",
I/flutter (20829): ║                     "isFulfillable": false,
I/flutter (20829): ║                     "canBePrepared": false,
I/flutter (20829): ║                     "paymentRequirement": {
I/flutter (20829): ║                         "status": "satisfied",
I/flutter (20829): ║                         "requiresPayment": false,
I/flutter (20829): ║                         "pricingStatus": "not_required",
I/flutter (20829): ║                         "blockingReason": "planning_incomplete",
I/flutter (20829): ║                         "canCreatePayment": false,
I/flutter (20829): ║                         "premiumSelectedCount": 0,
I/flutter (20829): ║                         "premiumPendingPaymentCount": 0,
I/flutter (20829): ║                         "pendingAmountHalala": 0,
I/flutter (20829): ║                         "amountHalala": 0,
I/flutter (20829): ║                         "currency": "SAR",
I/flutter (20829): ║                         "pricingStatusLabel": "غير مطلوب",
I/flutter (20829): ║                         "blockingReasonLabel": "التخطيط غير مكتمل"
I/flutter (20829): ║                    }
I/flutter (20829): ║                     "fulfillmentMode": "no_service",
I/flutter (20829): ║                     "consumptionState": "pending_day",
I/flutter (20829): ║                     "requiredMealCount": 4,
I/flutter (20829): ║                     "specifiedMealCount": 0,
I/flutter (20829): ║                     "unspecifiedMealCount": 4,
I/flutter (20829): ║                     "hasCustomerSelections": false,
I/flutter (20829): ║                     "requiresMealTypeKnowledge": false,
I/flutter (20829): ║                     "planningReady": false,
I/flutter (20829): ║                     "fulfillmentReady": false,
I/flutter (20829): ║                     "selectedMealIds": []
I/flutter (20829): ║                     "mealSlots": []
I/flutter (20829): ║                },
I/flutter (20829): ║                {
I/flutter (20829): ║                     "date": "2026-05-08",
I/flutter (20829): ║                     "day": "الجمعة",
I/flutter (20829): ║                     "month": "مايو",
I/flutter (20829): ║                     "dayNumber": 8,
I/flutter (20829): ║                     "status": "open",
I/flutter (20829): ║                     "statusLabel": "مفتوح",
I/flutter (20829): ║                     "selectedMeals": 0,
I/flutter (20829): ║                     "requiredMeals": 4,
I/flutter (20829): ║                     "commercialState": "draft",
I/flutter (20829): ║                     "commercialStateLabel": "مسودة",
I/flutter (20829): ║                     "isFulfillable": false,
I/flutter (20829): ║                     "canBePrepared": false,
I/flutter (20829): ║                     "paymentRequirement": {
I/flutter (20829): ║                         "status": "satisfied",
I/flutter (20829): ║                         "requiresPayment": false,
I/flutter (20829): ║                         "pricingStatus": "not_required",
I/flutter (20829): ║                         "blockingReason": "planning_incomplete",
I/flutter (20829): ║                         "canCreatePayment": false,
I/flutter (20829): ║                         "premiumSelectedCount": 0,
I/flutter (20829): ║                         "premiumPendingPaymentCount": 0,
I/flutter (20829): ║                         "pendingAmountHalala": 0,
I/flutter (20829): ║                         "amountHalala": 0,
I/flutter (20829): ║                         "currency": "SAR",
I/flutter (20829): ║                         "pricingStatusLabel": "غير مطلوب",
I/flutter (20829): ║                         "blockingReasonLabel": "التخطيط غير مكتمل"
I/flutter (20829): ║                    }
I/flutter (20829): ║                     "fulfillmentMode": "no_service",
I/flutter (20829): ║                     "consumptionState": "pending_day",
I/flutter (20829): ║                     "requiredMealCount": 4,
I/flutter (20829): ║                     "specifiedMealCount": 0,
I/flutter (20829): ║                     "unspecifiedMealCount": 4,
I/flutter (20829): ║                     "hasCustomerSelections": false,
I/flutter (20829): ║                     "requiresMealTypeKnowledge": false,
I/flutter (20829): ║                     "planningReady": false,
I/flutter (20829): ║                     "fulfillmentReady": false,
I/flutter (20829): ║                     "selectedMealIds": []
I/flutter (20829): ║                     "mealSlots": []
I/flutter (20829): ║                },
I/flutter (20829): ║                {
I/flutter (20829): ║                     "date": "2026-05-09",
I/flutter (20829): ║                     "day": "السبت",
I/flutter (20829): ║                     "month": "مايو",
I/flutter (20829): ║                     "dayNumber": 9,
I/flutter (20829): ║                     "status": "open",
I/flutter (20829): ║                     "statusLabel": "مفتوح",
I/flutter (20829): ║                     "selectedMeals": 0,
I/flutter (20829): ║                     "requiredMeals": 4,
I/flutter (20829): ║                     "commercialState": "draft",
I/flutter (20829): ║                     "commercialStateLabel": "مسودة",
I/flutter (20829): ║                     "isFulfillable": false,
I/flutter (20829): ║                     "canBePrepared": false,
I/flutter (20829): ║                     "paymentRequirement": {
I/flutter (20829): ║                         "status": "satisfied",
I/flutter (20829): ║                         "requiresPayment": false,
I/flutter (20829): ║                         "pricingStatus": "not_required",
I/flutter (20829): ║                         "blockingReason": "planning_incomplete",
I/flutter (20829): ║                         "canCreatePayment": false,
I/flutter (20829): ║                         "premiumSelectedCount": 0,
I/flutter (20829): ║                         "premiumPendingPaymentCount": 0,
I/flutter (20829): ║                         "pendingAmountHalala": 0,
I/flutter (20829): ║                         "amountHalala": 0,
I/flutter (20829): ║                         "currency": "SAR",
I/flutter (20829): ║                         "pricingStatusLabel": "غير مطلوب",
I/flutter (20829): ║                         "blockingReasonLabel": "التخطيط غير مكتمل"
I/flutter (20829): ║                    }
I/flutter (20829): ║                     "fulfillmentMode": "no_service",
I/flutter (20829): ║                     "consumptionState": "pending_day",
I/flutter (20829): ║                     "requiredMealCount": 4,
I/flutter (20829): ║                     "specifiedMealCount": 0,
I/flutter (20829): ║                     "unspecifiedMealCount": 4,
I/flutter (20829): ║                     "hasCustomerSelections": false,
I/flutter (20829): ║                     "requiresMealTypeKnowledge": false,
I/flutter (20829): ║                     "planningReady": false,
I/flutter (20829): ║                     "fulfillmentReady": false,
I/flutter (20829): ║                     "selectedMealIds": []
I/flutter (20829): ║                     "mealSlots": []
I/flutter (20829): ║                },
I/flutter (20829): ║                {
I/flutter (20829): ║                     "date": "2026-05-10",
I/flutter (20829): ║                     "day": "الأحد",
I/flutter (20829): ║                     "month": "مايو",
I/flutter (20829): ║                     "dayNumber": 10,
I/flutter (20829): ║                     "status": "open",
I/flutter (20829): ║                     "statusLabel": "مفتوح",
I/flutter (20829): ║                     "selectedMeals": 0,
I/flutter (20829): ║                     "requiredMeals": 4,
I/flutter (20829): ║                     "commercialState": "draft",
I/flutter (20829): ║                     "commercialStateLabel": "مسودة",
I/flutter (20829): ║                     "isFulfillable": false,
I/flutter (20829): ║                     "canBePrepared": false,
I/flutter (20829): ║                     "paymentRequirement": {
I/flutter (20829): ║                         "status": "satisfied",
I/flutter (20829): ║                         "requiresPayment": false,
I/flutter (20829): ║                         "pricingStatus": "not_required",
I/flutter (20829): ║                         "blockingReason": "planning_incomplete",
I/flutter (20829): ║                         "canCreatePayment": false,
I/flutter (20829): ║                         "premiumSelectedCount": 0,
I/flutter (20829): ║                         "premiumPendingPaymentCount": 0,
I/flutter (20829): ║                         "pendingAmountHalala": 0,
I/flutter (20829): ║                         "amountHalala": 0,
I/flutter (20829): ║                         "currency": "SAR",
I/flutter (20829): ║                         "pricingStatusLabel": "غير مطلوب",
I/flutter (20829): ║                         "blockingReasonLabel": "التخطيط غير مكتمل"
I/flutter (20829): ║                    }
I/flutter (20829): ║                     "fulfillmentMode": "no_service",
I/flutter (20829): ║                     "consumptionState": "pending_day",
I/flutter (20829): ║                     "requiredMealCount": 4,
I/flutter (20829): ║                     "specifiedMealCount": 0,
I/flutter (20829): ║                     "unspecifiedMealCount": 4,
I/flutter (20829): ║                     "hasCustomerSelections": false,
I/flutter (20829): ║                     "requiresMealTypeKnowledge": false,
I/flutter (20829): ║                     "planningReady": false,
I/flutter (20829): ║                     "fulfillmentReady": false,
I/flutter (20829): ║                     "selectedMealIds": []
I/flutter (20829): ║                     "mealSlots": []
I/flutter (20829): ║                },
I/flutter (20829): ║                {
I/flutter (20829): ║                     "date": "2026-05-11",
I/flutter (20829): ║                     "day": "الاثنين",
I/flutter (20829): ║                     "month": "مايو",
I/flutter (20829): ║                     "dayNumber": 11,
I/flutter (20829): ║                     "status": "open",
I/flutter (20829): ║                     "statusLabel": "مفتوح",
I/flutter (20829): ║                     "selectedMeals": 0,
I/flutter (20829): ║                     "requiredMeals": 4,
I/flutter (20829): ║                     "commercialState": "draft",
I/flutter (20829): ║                     "commercialStateLabel": "مسودة",
I/flutter (20829): ║                     "isFulfillable": false,
I/flutter (20829): ║                     "canBePrepared": false,
I/flutter (20829): ║                     "paymentRequirement": {
I/flutter (20829): ║                         "status": "satisfied",
I/flutter (20829): ║                         "requiresPayment": false,
I/flutter (20829): ║                         "pricingStatus": "not_required",
I/flutter (20829): ║                         "blockingReason": "planning_incomplete",
I/flutter (20829): ║                         "canCreatePayment": false,
I/flutter (20829): ║                         "premiumSelectedCount": 0,
I/flutter (20829): ║                         "premiumPendingPaymentCount": 0,
I/flutter (20829): ║                         "pendingAmountHalala": 0,
I/flutter (20829): ║                         "amountHalala": 0,
I/flutter (20829): ║                         "currency": "SAR",
I/flutter (20829): ║                         "pricingStatusLabel": "غير مطلوب",
I/flutter (20829): ║                         "blockingReasonLabel": "التخطيط غير مكتمل"
I/flutter (20829): ║                    }
I/flutter (20829): ║                     "fulfillmentMode": "no_service",
I/flutter (20829): ║                     "consumptionState": "pending_day",
I/flutter (20829): ║                     "requiredMealCount": 4,
I/flutter (20829): ║                     "specifiedMealCount": 0,
I/flutter (20829): ║                     "unspecifiedMealCount": 4,
I/flutter (20829): ║                     "hasCustomerSelections": false,
I/flutter (20829): ║                     "requiresMealTypeKnowledge": false,
I/flutter (20829): ║                     "planningReady": false,
I/flutter (20829): ║                     "fulfillmentReady": false,
I/flutter (20829): ║                     "selectedMealIds": []
I/flutter (20829): ║                     "mealSlots": []
I/flutter (20829): ║                },
I/flutter (20829): ║                {
I/flutter (20829): ║                     "date": "2026-05-12",
I/flutter (20829): ║                     "day": "الثلاثاء",
I/flutter (20829): ║                     "month": "مايو",
I/flutter (20829): ║                     "dayNumber": 12,
I/flutter (20829): ║                     "status": "open",
I/flutter (20829): ║                     "statusLabel": "مفتوح",
I/flutter (20829): ║                     "selectedMeals": 0,
I/flutter (20829): ║                     "requiredMeals": 4,
I/flutter (20829): ║                     "commercialState": "draft",
I/flutter (20829): ║                     "commercialStateLabel": "مسودة",
I/flutter (20829): ║                     "isFulfillable": false,
I/flutter (20829): ║                     "canBePrepared": false,
I/flutter (20829): ║                     "paymentRequirement": {
I/flutter (20829): ║                         "status": "satisfied",
I/flutter (20829): ║                         "requiresPayment": false,
I/flutter (20829): ║                         "pricingStatus": "not_required",
I/flutter (20829): ║                         "blockingReason": "planning_incomplete",
I/flutter (20829): ║                         "canCreatePayment": false,
I/flutter (20829): ║                         "premiumSelectedCount": 0,
I/flutter (20829): ║                         "premiumPendingPaymentCount": 0,
I/flutter (20829): ║                         "pendingAmountHalala": 0,
I/flutter (20829): ║                         "amountHalala": 0,
I/flutter (20829): ║                         "currency": "SAR",
I/flutter (20829): ║                         "pricingStatusLabel": "غير مطلوب",
I/flutter (20829): ║                         "blockingReasonLabel": "التخطيط غير مكتمل"
I/flutter (20829): ║                    }
I/flutter (20829): ║                     "fulfillmentMode": "no_service",
I/flutter (20829): ║                     "consumptionState": "pending_day",
I/flutter (20829): ║                     "requiredMealCount": 4,
I/flutter (20829): ║                     "specifiedMealCount": 0,
I/flutter (20829): ║                     "unspecifiedMealCount": 4,
I/flutter (20829): ║                     "hasCustomerSelections": false,
I/flutter (20829): ║                     "requiresMealTypeKnowledge": false,
I/flutter (20829): ║                     "planningReady": false,
I/flutter (20829): ║                     "fulfillmentReady": false,
I/flutter (20829): ║                     "selectedMealIds": []
I/flutter (20829): ║                     "mealSlots": []
I/flutter (20829): ║                },
I/flutter (20829): ║                {
I/flutter (20829): ║                     "date": "2026-05-13",
I/flutter (20829): ║                     "day": "الأربعاء",
I/flutter (20829): ║                     "month": "مايو",
I/flutter (20829): ║                     "dayNumber": 13,
I/flutter (20829): ║                     "status": "open",
I/flutter (20829): ║                     "statusLabel": "مفتوح",
I/flutter (20829): ║                     "selectedMeals": 0,
I/flutter (20829): ║                     "requiredMeals": 4,
I/flutter (20829): ║                     "commercialState": "draft",
I/flutter (20829): ║                     "commercialStateLabel": "مسودة",
I/flutter (20829): ║                     "isFulfillable": false,
I/flutter (20829): ║                     "canBePrepared": false,
I/flutter (20829): ║                     "paymentRequirement": {
I/flutter (20829): ║                         "status": "satisfied",
I/flutter (20829): ║                         "requiresPayment": false,
I/flutter (20829): ║                         "pricingStatus": "not_required",
I/flutter (20829): ║                         "blockingReason": "planning_incomplete",
I/flutter (20829): ║                         "canCreatePayment": false,
I/flutter (20829): ║                         "premiumSelectedCount": 0,
I/flutter (20829): ║                         "premiumPendingPaymentCount": 0,
I/flutter (20829): ║                         "pendingAmountHalala": 0,
I/flutter (20829): ║                         "amountHalala": 0,
I/flutter (20829): ║                         "currency": "SAR",
I/flutter (20829): ║                         "pricingStatusLabel": "غير مطلوب",
I/flutter (20829): ║                         "blockingReasonLabel": "التخطيط غير مكتمل"
I/flutter (20829): ║                    }
I/flutter (20829): ║                     "fulfillmentMode": "no_service",
I/flutter (20829): ║                     "consumptionState": "pending_day",
I/flutter (20829): ║                     "requiredMealCount": 4,
I/flutter (20829): ║                     "specifiedMealCount": 0,
I/flutter (20829): ║                     "unspecifiedMealCount": 4,
I/flutter (20829): ║                     "hasCustomerSelections": false,
I/flutter (20829): ║                     "requiresMealTypeKnowledge": false,
I/flutter (20829): ║                     "planningReady": false,
I/flutter (20829): ║                     "fulfillmentReady": false,
I/flutter (20829): ║                     "selectedMealIds": []
I/flutter (20829): ║                     "mealSlots": []
I/flutter (20829): ║                },
I/flutter (20829): ║                {
I/flutter (20829): ║                     "date": "2026-05-14",
I/flutter (20829): ║                     "day": "الخميس",
I/flutter (20829): ║                     "month": "مايو",
I/flutter (20829): ║                     "dayNumber": 14,
I/flutter (20829): ║                     "status": "open",
I/flutter (20829): ║                     "statusLabel": "مفتوح",
I/flutter (20829): ║                     "selectedMeals": 0,
I/flutter (20829): ║                     "requiredMeals": 4,
I/flutter (20829): ║                     "commercialState": "draft",
I/flutter (20829): ║                     "commercialStateLabel": "مسودة",
I/flutter (20829): ║                     "isFulfillable": false,
I/flutter (20829): ║                     "canBePrepared": false,
I/flutter (20829): ║                     "paymentRequirement": {
I/flutter (20829): ║                         "status": "satisfied",
I/flutter (20829): ║                         "requiresPayment": false,
I/flutter (20829): ║                         "pricingStatus": "not_required",
I/flutter (20829): ║                         "blockingReason": "planning_incomplete",
I/flutter (20829): ║                         "canCreatePayment": false,
I/flutter (20829): ║                         "premiumSelectedCount": 0,
I/flutter (20829): ║                         "premiumPendingPaymentCount": 0,
I/flutter (20829): ║                         "pendingAmountHalala": 0,
I/flutter (20829): ║                         "amountHalala": 0,
I/flutter (20829): ║                         "currency": "SAR",
I/flutter (20829): ║                         "pricingStatusLabel": "غير مطلوب",
I/flutter (20829): ║                         "blockingReasonLabel": "التخطيط غير مكتمل"
I/flutter (20829): ║                    }
I/flutter (20829): ║                     "fulfillmentMode": "no_service",
I/flutter (20829): ║                     "consumptionState": "pending_day",
I/flutter (20829): ║                     "requiredMealCount": 4,
I/flutter (20829): ║                     "specifiedMealCount": 0,
I/flutter (20829): ║                     "unspecifiedMealCount": 4,
I/flutter (20829): ║                     "hasCustomerSelections": false,
I/flutter (20829): ║                     "requiresMealTypeKnowledge": false,
I/flutter (20829): ║                     "planningReady": false,
I/flutter (20829): ║                     "fulfillmentReady": false,
I/flutter (20829): ║                     "selectedMealIds": []
I/flutter (20829): ║                     "mealSlots": []
I/flutter (20829): ║                },
I/flutter (20829): ║                {
I/flutter (20829): ║                     "date": "2026-05-15",
I/flutter (20829): ║                     "day": "الجمعة",
I/flutter (20829): ║                     "month": "مايو",
I/flutter (20829): ║                     "dayNumber": 15,
I/flutter (20829): ║                     "status": "open",
I/flutter (20829): ║                     "statusLabel": "مفتوح",
I/flutter (20829): ║                     "selectedMeals": 0,
I/flutter (20829): ║                     "requiredMeals": 4,
I/flutter (20829): ║                     "commercialState": "draft",
I/flutter (20829): ║                     "commercialStateLabel": "مسودة",
I/flutter (20829): ║                     "isFulfillable": false,
I/flutter (20829): ║                     "canBePrepared": false,
I/flutter (20829): ║                     "paymentRequirement": {
I/flutter (20829): ║                         "status": "satisfied",
I/flutter (20829): ║                         "requiresPayment": false,
I/flutter (20829): ║                         "pricingStatus": "not_required",
I/flutter (20829): ║                         "blockingReason": "planning_incomplete",
I/flutter (20829): ║                         "canCreatePayment": false,
I/flutter (20829): ║                         "premiumSelectedCount": 0,
I/flutter (20829): ║                         "premiumPendingPaymentCount": 0,
I/flutter (20829): ║                         "pendingAmountHalala": 0,
I/flutter (20829): ║                         "amountHalala": 0,
I/flutter (20829): ║                         "currency": "SAR",
I/flutter (20829): ║                         "pricingStatusLabel": "غير مطلوب",
I/flutter (20829): ║                         "blockingReasonLabel": "التخطيط غير مكتمل"
I/flutter (20829): ║                    }
I/flutter (20829): ║                     "fulfillmentMode": "no_service",
I/flutter (20829): ║                     "consumptionState": "pending_day",
I/flutter (20829): ║                     "requiredMealCount": 4,
I/flutter (20829): ║                     "specifiedMealCount": 0,
I/flutter (20829): ║                     "unspecifiedMealCount": 4,
I/flutter (20829): ║                     "hasCustomerSelections": false,
I/flutter (20829): ║                     "requiresMealTypeKnowledge": false,
I/flutter (20829): ║                     "planningReady": false,
I/flutter (20829): ║                     "fulfillmentReady": false,
I/flutter (20829): ║                     "selectedMealIds": []
I/flutter (20829): ║                     "mealSlots": []
I/flutter (20829): ║                },
I/flutter (20829): ║                {
I/flutter (20829): ║                     "date": "2026-05-16",
I/flutter (20829): ║                     "day": "السبت",
I/flutter (20829): ║                     "month": "مايو",
I/flutter (20829): ║                     "dayNumber": 16,
I/flutter (20829): ║                     "status": "open",
I/flutter (20829): ║                     "statusLabel": "مفتوح",
I/flutter (20829): ║                     "selectedMeals": 0,
I/flutter (20829): ║                     "requiredMeals": 4,
I/flutter (20829): ║                     "commercialState": "draft",
I/flutter (20829): ║                     "commercialStateLabel": "مسودة",
I/flutter (20829): ║                     "isFulfillable": false,
I/flutter (20829): ║                     "canBePrepared": false,
I/flutter (20829): ║                     "paymentRequirement": {
I/flutter (20829): ║                         "status": "satisfied",
I/flutter (20829): ║                         "requiresPayment": false,
I/flutter (20829): ║                         "pricingStatus": "not_required",
I/flutter (20829): ║                         "blockingReason": "planning_incomplete",
I/flutter (20829): ║                         "canCreatePayment": false,
I/flutter (20829): ║                         "premiumSelectedCount": 0,
I/flutter (20829): ║                         "premiumPendingPaymentCount": 0,
I/flutter (20829): ║                         "pendingAmountHalala": 0,
I/flutter (20829): ║                         "amountHalala": 0,
I/flutter (20829): ║                         "currency": "SAR",
I/flutter (20829): ║                         "pricingStatusLabel": "غير مطلوب",
I/flutter (20829): ║                         "blockingReasonLabel": "التخطيط غير مكتمل"
I/flutter (20829): ║                    }
I/flutter (20829): ║                     "fulfillmentMode": "no_service",
I/flutter (20829): ║                     "consumptionState": "pending_day",
I/flutter (20829): ║                     "requiredMealCount": 4,
I/flutter (20829): ║                     "specifiedMealCount": 0,
I/flutter (20829): ║                     "unspecifiedMealCount": 4,
I/flutter (20829): ║                     "hasCustomerSelections": false,
I/flutter (20829): ║                     "requiresMealTypeKnowledge": false,
I/flutter (20829): ║                     "planningReady": false,
I/flutter (20829): ║                     "fulfillmentReady": false,
I/flutter (20829): ║                     "selectedMealIds": []
I/flutter (20829): ║                     "mealSlots": []
I/flutter (20829): ║                },
I/flutter (20829): ║                {
I/flutter (20829): ║                     "date": "2026-05-17",
I/flutter (20829): ║                     "day": "الأحد",
I/flutter (20829): ║                     "month": "مايو",
I/flutter (20829): ║                     "dayNumber": 17,
I/flutter (20829): ║                     "status": "open",
I/flutter (20829): ║                     "statusLabel": "مفتوح",
I/flutter (20829): ║                     "selectedMeals": 0,
I/flutter (20829): ║                     "requiredMeals": 4,
I/flutter (20829): ║                     "commercialState": "draft",
I/flutter (20829): ║                     "commercialStateLabel": "مسودة",
I/flutter (20829): ║                     "isFulfillable": false,
I/flutter (20829): ║                     "canBePrepared": false,
I/flutter (20829): ║                     "paymentRequirement": {
I/flutter (20829): ║                         "status": "satisfied",
I/flutter (20829): ║                         "requiresPayment": false,
I/flutter (20829): ║                         "pricingStatus": "not_required",
I/flutter (20829): ║                         "blockingReason": "planning_incomplete",
I/flutter (20829): ║                         "canCreatePayment": false,
I/flutter (20829): ║                         "premiumSelectedCount": 0,
I/flutter (20829): ║                         "premiumPendingPaymentCount": 0,
I/flutter (20829): ║                         "pendingAmountHalala": 0,
I/flutter (20829): ║                         "amountHalala": 0,
I/flutter (20829): ║                         "currency": "SAR",
I/flutter (20829): ║                         "pricingStatusLabel": "غير مطلوب",
I/flutter (20829): ║                         "blockingReasonLabel": "التخطيط غير مكتمل"
I/flutter (20829): ║                    }
I/flutter (20829): ║                     "fulfillmentMode": "no_service",
I/flutter (20829): ║                     "consumptionState": "pending_day",
I/flutter (20829): ║                     "requiredMealCount": 4,
I/flutter (20829): ║                     "specifiedMealCount": 0,
I/flutter (20829): ║                     "unspecifiedMealCount": 4,
I/flutter (20829): ║                     "hasCustomerSelections": false,
I/flutter (20829): ║                     "requiresMealTypeKnowledge": false,
I/flutter (20829): ║                     "planningReady": false,
I/flutter (20829): ║                     "fulfillmentReady": false,
I/flutter (20829): ║                     "selectedMealIds": []
I/flutter (20829): ║                     "mealSlots": []
I/flutter (20829): ║                },
I/flutter (20829): ║                {
I/flutter (20829): ║                     "date": "2026-05-18",
I/flutter (20829): ║                     "day": "الاثنين",
I/flutter (20829): ║                     "month": "مايو",
I/flutter (20829): ║                     "dayNumber": 18,
I/flutter (20829): ║                     "status": "open",
I/flutter (20829): ║                     "statusLabel": "مفتوح",
I/flutter (20829): ║                     "selectedMeals": 0,
I/flutter (20829): ║                     "requiredMeals": 4,
I/flutter (20829): ║                     "commercialState": "draft",
I/flutter (20829): ║                     "commercialStateLabel": "مسودة",
I/flutter (20829): ║                     "isFulfillable": false,
I/flutter (20829): ║                     "canBePrepared": false,
I/flutter (20829): ║                     "paymentRequirement": {
I/flutter (20829): ║                         "status": "satisfied",
I/flutter (20829): ║                         "requiresPayment": false,
I/flutter (20829): ║                         "pricingStatus": "not_required",
I/flutter (20829): ║                         "blockingReason": "planning_incomplete",
I/flutter (20829): ║                         "canCreatePayment": false,
I/flutter (20829): ║                         "premiumSelectedCount": 0,
I/flutter (20829): ║                         "premiumPendingPaymentCount": 0,
I/flutter (20829): ║                         "pendingAmountHalala": 0,
I/flutter (20829): ║                         "amountHalala": 0,
I/flutter (20829): ║                         "currency": "SAR",
I/flutter (20829): ║                         "pricingStatusLabel": "غير مطلوب",
I/flutter (20829): ║                         "blockingReasonLabel": "التخطيط غير مكتمل"
I/flutter (20829): ║                    }
I/flutter (20829): ║                     "fulfillmentMode": "no_service",
I/flutter (20829): ║                     "consumptionState": "pending_day",
I/flutter (20829): ║                     "requiredMealCount": 4,
I/flutter (20829): ║                     "specifiedMealCount": 0,
I/flutter (20829): ║                     "unspecifiedMealCount": 4,
I/flutter (20829): ║                     "hasCustomerSelections": false,
I/flutter (20829): ║                     "requiresMealTypeKnowledge": false,
I/flutter (20829): ║                     "planningReady": false,
I/flutter (20829): ║                     "fulfillmentReady": false,
I/flutter (20829): ║                     "selectedMealIds": []
I/flutter (20829): ║                     "mealSlots": []
I/flutter (20829): ║                },
I/flutter (20829): ║                {
I/flutter (20829): ║                     "date": "2026-05-19",
I/flutter (20829): ║                     "day": "الثلاثاء",
I/flutter (20829): ║                     "month": "مايو",
I/flutter (20829): ║                     "dayNumber": 19,
I/flutter (20829): ║                     "status": "open",
I/flutter (20829): ║                     "statusLabel": "مفتوح",
I/flutter (20829): ║                     "selectedMeals": 0,
I/flutter (20829): ║                     "requiredMeals": 4,
I/flutter (20829): ║                     "commercialState": "draft",
I/flutter (20829): ║                     "commercialStateLabel": "مسودة",
I/flutter (20829): ║                     "isFulfillable": false,
I/flutter (20829): ║                     "canBePrepared": false,
I/flutter (20829): ║                     "paymentRequirement": {
I/flutter (20829): ║                         "status": "satisfied",
I/flutter (20829): ║                         "requiresPayment": false,
I/flutter (20829): ║                         "pricingStatus": "not_required",
I/flutter (20829): ║                         "blockingReason": "planning_incomplete",
I/flutter (20829): ║                         "canCreatePayment": false,
I/flutter (20829): ║                         "premiumSelectedCount": 0,
I/flutter (20829): ║                         "premiumPendingPaymentCount": 0,
I/flutter (20829): ║                         "pendingAmountHalala": 0,
I/flutter (20829): ║                         "amountHalala": 0,
I/flutter (20829): ║                         "currency": "SAR",
I/flutter (20829): ║                         "pricingStatusLabel": "غير مطلوب",
I/flutter (20829): ║                         "blockingReasonLabel": "التخطيط غير مكتمل"
I/flutter (20829): ║                    }
I/flutter (20829): ║                     "fulfillmentMode": "no_service",
I/flutter (20829): ║                     "consumptionState": "pending_day",
I/flutter (20829): ║                     "requiredMealCount": 4,
I/flutter (20829): ║                     "specifiedMealCount": 0,
I/flutter (20829): ║                     "unspecifiedMealCount": 4,
I/flutter (20829): ║                     "hasCustomerSelections": false,
I/flutter (20829): ║                     "requiresMealTypeKnowledge": false,
I/flutter (20829): ║                     "planningReady": false,
I/flutter (20829): ║                     "fulfillmentReady": false,
I/flutter (20829): ║                     "selectedMealIds": []
I/flutter (20829): ║                     "mealSlots": []
I/flutter (20829): ║                }
I/flutter (20829): ║             ]
I/flutter (20829): ║        }
I/flutter (20829): ║    }
I/flutter (20829): ║
I/flutter (20829): ╚══════════════════════════════════════════════════════════════════════════════════════════╝
I/flutter (20829): onChange -- TimelineBloc, Change { currentState: TimelineLoading(), nextState: TimelineLoaded(Instance of 'TimelineModel') }
E/libEGL  (20829): called unimplemented OpenGL ES API
