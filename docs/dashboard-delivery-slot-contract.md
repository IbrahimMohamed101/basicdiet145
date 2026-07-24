# Dashboard subscription delivery slot contract

Delivery subscriptions must send a canonical selected period:

```json
{
  "delivery": {
    "type": "delivery",
    "zoneId": "<zone ObjectId>",
    "address": {},
    "slot": {
      "type": "delivery",
      "slotId": "slot_10_12",
      "window": "10:00-12:00"
    }
  }
}
```

For backward compatibility, the backend also accepts an exact unique
`delivery.window` / top-level `deliveryWindow` and resolves its configured
`slotId`. When several configured periods exist and no period is selected, the
request remains invalid; the backend never chooses a random period.
