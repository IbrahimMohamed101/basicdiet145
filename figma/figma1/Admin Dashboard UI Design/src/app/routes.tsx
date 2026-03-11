import { createBrowserRouter } from "react-router";
import { DashboardLayout } from "./components/layout/DashboardLayout";
import { Dashboard } from "./pages/Dashboard";
import { MenuAddons } from "./pages/MenuAddons";
import { SaladIngredients } from "./pages/SaladIngredients";
import { Orders } from "./pages/Orders";
import { Payments } from "./pages/Payments";
import { Kitchen } from "./pages/Kitchen";
import { Courier } from "./pages/Courier";
import { Settings } from "./pages/Settings";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <DashboardLayout />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: "dashboard", element: <Dashboard /> },
      { path: "menu/addons", element: <MenuAddons /> },
      { path: "menu/salad-ingredients", element: <SaladIngredients /> },
      { path: "orders", element: <Orders /> },
      { path: "payments", element: <Payments /> },
      { path: "kitchen", element: <Kitchen /> },
      { path: "courier", element: <Courier /> },
      { path: "settings", element: <Settings /> },
    ],
  },
]);