import { createBrowserRouter } from "react-router";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { AppUsers } from "./pages/AppUsers";
import { UserDetails } from "./pages/UserDetails";
import { StaffUsers } from "./pages/StaffUsers";
import { Subscriptions } from "./pages/Subscriptions";
import { SubscriptionDetails } from "./pages/SubscriptionDetails";
import { Plans } from "./pages/Plans";
import { PlanDetails } from "./pages/PlanDetails";
import { RegularMeals } from "./pages/RegularMeals";
import { PremiumMeals } from "./pages/PremiumMeals";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Layout,
    children: [
      { index: true, Component: Dashboard },
      { path: "users", Component: AppUsers },
      { path: "users/:id", Component: UserDetails },
      { path: "dashboard-users", Component: StaffUsers },
      { path: "subscriptions", Component: Subscriptions },
      { path: "subscriptions/:id", Component: SubscriptionDetails },
      { path: "plans", Component: Plans },
      { path: "plans/:id", Component: PlanDetails },
      { path: "menu/meals", Component: RegularMeals },
      { path: "menu/premium-meals", Component: PremiumMeals },
    ],
  },
]);