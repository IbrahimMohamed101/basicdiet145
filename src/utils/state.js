const transitions = {
  open: ["locked", "in_preparation", "skipped", "frozen", "delivery_canceled", "canceled_at_branch"],
  frozen: [],
  locked: ["open", "in_preparation", "out_for_delivery", "delivery_canceled", "canceled_at_branch"],
  in_preparation: ["out_for_delivery", "ready_for_pickup", "delivery_canceled", "canceled_at_branch"],
  out_for_delivery: ["fulfilled", "delivery_canceled"],
  ready_for_pickup: ["fulfilled", "canceled_at_branch", "no_show"],
  fulfilled: [],
  consumed_without_preparation: [],
  delivery_canceled: ["open"],
  canceled_at_branch: ["open"],
  no_show: ["open"],
  skipped: [],
};

function canTransition(from, to) {
  return transitions[from] && transitions[from].includes(to);
}

module.exports = { canTransition };
