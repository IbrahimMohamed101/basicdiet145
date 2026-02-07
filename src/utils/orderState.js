const transitions = {
  created: ["confirmed", "canceled"],
  confirmed: ["preparing", "canceled"],
  preparing: ["out_for_delivery", "ready_for_pickup", "canceled"],
  out_for_delivery: ["fulfilled", "canceled"],
  ready_for_pickup: ["fulfilled", "canceled"],
  fulfilled: [],
  canceled: [],
};

function canOrderTransition(from, to) {
  return transitions[from] && transitions[from].includes(to);
}

module.exports = { canOrderTransition };
