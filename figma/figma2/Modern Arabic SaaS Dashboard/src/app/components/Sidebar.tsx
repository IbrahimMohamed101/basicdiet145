import { Link, useLocation } from "react-router";
import {
  LayoutDashboard,
  Users,
  UserCog,
  Package,
  ChevronRight,
  CreditCard,
  UtensilsCrossed,
} from "lucide-react";
import { cn } from "./ui/utils";

const menuItems = [
  {
    label: "لوحة التحكم",
    path: "/",
    icon: LayoutDashboard,
  },
  {
    label: "مستخدمي التطبيق",
    path: "/users",
    icon: Users,
  },
  {
    label: "إدارة الموظفين",
    path: "/dashboard-users",
    icon: UserCog,
  },
  {
    label: "الاشتراكات",
    path: "/subscriptions",
    icon: Package,
  },
  {
    label: "الباقات",
    path: "/plans",
    icon: CreditCard,
  },
  {
    label: "الوجبات العادية",
    path: "/menu/meals",
    icon: UtensilsCrossed,
  },
  {
    label: "الوجبات المميزة",
    path: "/menu/premium-meals",
    icon: UtensilsCrossed,
  },
];

export function Sidebar() {
  const location = useLocation();

  return (
    <aside className="w-64 bg-[#1B4332] text-white flex flex-col">
      <div className="p-6 border-b border-[#2D6A4F]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#40916C] rounded-lg flex items-center justify-center">
            <Package className="w-6 h-6" />
          </div>
          <div>
            <h1 className="font-bold text-lg">نظام الاشتراكات</h1>
            <p className="text-xs text-[#95D5B2]">لوحة الإدارة</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        {menuItems.map((item) => {
          const isActive = location.pathname === item.path;
          const Icon = item.icon;

          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-lg transition-colors",
                isActive
                  ? "bg-[#40916C] text-white"
                  : "text-[#D8F3DC] hover:bg-[#2D6A4F]"
              )}
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              <span className="flex-1">{item.label}</span>
              {isActive && <ChevronRight className="w-4 h-4" />}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-[#2D6A4F]">
        <div className="text-xs text-[#95D5B2] text-center">
          © 2026 جميع الحقوق محفوظة
        </div>
      </div>
    </aside>
  );
}