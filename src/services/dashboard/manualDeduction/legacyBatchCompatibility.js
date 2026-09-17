"use strict";

const mongoose = require("mongoose");
const SubscriptionEntitlementBatch = require("../../../models/SubscriptionEntitlementBatch");

/**
 * Older entitlement-batch documents may carry the package validity end in
 * `endDate` only. Newer code persists `validityEndDate`, while deduction
 * readers intentionally still accept both names. Canonicalize the legacy
 * shape before the stacked manual-deduction flow executes so its atomic
 * Mongo filters do not silently exclude an otherwise valid package.
 *
 * This repair is idempotent: it only fills a missing/null validityEndDate
 * from an existing Date-valued endDate and never overwrites a canonical
 * value.
 */
async function repairLegacyBatchValidityEndDates(subscriptionId) {
  if (!mongoose.Types.ObjectId.isValid(subscriptionId)) return 0;

  const result = await SubscriptionEntitlementBatch.collection.updateMany(
    {
      containerSubscriptionId: new mongoose.Types.ObjectId(String(subscriptionId)),
      $or: [
        { validityEndDate: { $exists: false } },
        { validityEndDate: null },
      ],
      endDate: { $type: "date" },
    },
    [
      {
        $set: {
          validityEndDate: "$endDate",
        },
      },
    ]
  );

  return Number(result && result.modifiedCount || 0);
}

module.exports = {
  repairLegacyBatchValidityEndDates,
};
