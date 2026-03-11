import { NavLink } from "react-router";
import { 
  LayoutDashboard, 
  Package, 
  Salad, 
  ShoppingCart, 
  CreditCard,
  Users,
  Settings,
  ChefHat,
  Truck
} from "lucide-react";

const navItems = [
  { to: "/dashboard", label: "لوحة التحكم", labelEn: "Dashboard", icon: LayoutDashboard },
  { to: "/menu/addons", label: "الإضافات", labelEn: "Addons", icon: Package },
  { to: "/menu/salad-ingredients", label: "مكونات السلطة", labelEn: "Salad Ingredients", icon: Salad },
  { to: "/orders", label: "الطلبات", labelEn: "Orders", icon: ShoppingCart },
  { to: "/payments", label: "المدفوعات", labelEn: "Payments", icon: CreditCard },
  { to: "/kitchen", label: "المطبخ", labelEn: "Kitchen", icon: ChefHat },
  { to: "/courier", label: "التوصيل", labelEn: "Courier", icon: Truck },
  { to: "/settings", label: "الإعدادات", labelEn: "Settings", icon: Settings },
];

export function Sidebar() {
  return (
    <aside className="w-[260px] bg-[#1B4332] text-white flex flex-col">
      {/* Logo & Brand */}
      <div className="p-6 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#40916C] rounded-lg flex items-center justify-center">
            <ChefHat className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ fontFamily: 'Cairo, sans-serif' }}>
              BasicDiet145
            </h1>
            <p className="text-xs text-white/60">لوحة التحكم</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                isActive
                  ? "bg-[#40916C] text-white"
                  : "text-white/80 hover:bg-white/10 hover:text-white"
              }`
            }
          >
            <item.icon className="w-5 h-5" />
            <div className="flex-1">
              <div className="text-sm font-medium" style={{ fontFamily: 'Cairo, sans-serif' }}>
                {item.label}
              </div>
              <div className="text-xs text-white/60">{item.labelEn}</div>
            </div>
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-white/10">
        <div className="flex items-center gap-3 px-4 py-2">
          <div className="w-8 h-8 bg-[#40916C] rounded-full flex items-center justify-center">
            <Users className="w-4 h-4" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-medium" style={{ fontFamily: 'Cairo, sans-serif' }}>
              المدير
            </div>
            <div className="text-xs text-white/60">Admin</div>
          </div>
        </div>
      </div>
    </aside>
  );
}