"use strict";

// Historical workflow entry point kept for CI compatibility. The former policy
// injected an app-only `sandwich` card that Dashboard could not author or display.
// The canonical regression now verifies that this injector is not mounted.
require("./retiredSubscriptionSandwichCard.test");
