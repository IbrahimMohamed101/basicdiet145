const transitions = {
  open: ["locked", "skipped"],
  locked: ["in_preparation", "out_for_delivery", "ready_for_pickup"],
  in_preparation: ["out_for_delivery", "ready_for_pickup"],
  out_for_delivery: ["fulfilled"],
  ready_for_pickup: ["fulfilled"],
  fulfilled: [],
  skipped: [],
};

function canTransition(from, to) {
  return transitions[from] && transitions[from].includes(to);
}

module.exports = { canTransition };
