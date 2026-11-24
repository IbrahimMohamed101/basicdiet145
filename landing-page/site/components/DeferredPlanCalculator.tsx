import { PlanCalculator } from "./PlanCalculator";

// Render the controls on the server. Prices still come from the existing
// live catalog after hydration; unavailable prices are never fabricated.
export function DeferredPlanCalculator() {
  return (
    <div data-deferred-calculator="">
      <PlanCalculator sectionId="plans" context="home" />
    </div>
  );
}
