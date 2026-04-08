const transitions = {
  open: ["locked", "skipped", "frozen"],
  frozen: [],
  locked: ["in_preparation", "out_for_delivery", "ready_for_pickup", "canceled_at_branch"],
  in_preparation: ["out_for_delivery", "ready_for_pickup", "canceled_at_branch"],
  out_for_delivery: ["fulfilled", "delivery_canceled"],
  ready_for_pickup: ["fulfilled", "canceled_at_branch", "no_show"],
  fulfilled: [],
  delivery_canceled: [],
  canceled_at_branch: [],
  no_show: [],
  skipped: [],
};

function canTransition(from, to) {
  return transitions[from] && transitions[from].includes(to);
}

module.exports = { canTransition };
