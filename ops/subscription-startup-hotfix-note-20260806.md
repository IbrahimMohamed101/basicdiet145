# Subscription startup composition hotfix

This note intentionally documents no credentials or deployment configuration.

The hotfix ensures the canonical subscription backend repair composition is installed before subscription-stacking startup installers can load the cancellation/selection/allocation chain and capture legacy add-on pricing exports.

A fresh-process regression test executes `src/index.js` with an injected database boundary and fails if startup aborts with `SUBSCRIPTION_REPAIR_COMPOSITION_INCOMPLETE` before reaching that boundary.
