"use strict";
const Merge = require("../../models/CustomerAccountMerge");
const Event = require("../../models/RetentionFollowupEvent");

// Sticky opt-out. Only an explicit, audited consent workflow may ever clear it;
// a later staff outcome, new subscription or completed account merge cannot.
async function getRetentionContactPolicy(userId) {
  const merges = await Merge.find({ state: "completed" })
    .select("sourceUserId targetUserId").lean();
  const canonical = (id) => {
    let key = String(id);
    const path = [];
    const targets = new Map(merges.map((m) => [String(m.sourceUserId), String(m.targetUserId)]));
    while (targets.has(key) && !path.includes(key)) { path.push(key); key = targets.get(key); }
    return path.includes(key) ? path.slice(path.indexOf(key)).sort()[0] : key;
  };
  const target = canonical(userId);
  const ids = [...new Set([String(userId), target, ...merges.flatMap((m) => [m.sourceUserId, m.targetUserId])
    .filter((id) => canonical(id) === target).map(String)])];
  return { userIds: ids, doNotContact: Boolean(await Event.exists({ userId: { $in: ids }, outcome: "do_not_contact" })) };
}
module.exports = { getRetentionContactPolicy };
