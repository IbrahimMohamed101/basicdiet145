import { Search, Bell, LogOut } from "lucide-react";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { useLocation } from "react-router";

const pageNames: Record<string, { ar: string; en: string }> = {
  "/": { ar: "لوحة التحكم", en: "Dashboard" },
  "/dashboard": { ar: "لوحة التحكم", en: "Dashboard" },
  "/menu/addons": { ar: "الإضافات", en: "Menu - Addons" },
  "/menu/salad-ingredients": { ar: "مكونات السلطة", en: "Menu - Salad Ingredients" },
  "/orders": { ar: "الطلبات", en: "Orders" },
  "/payments": { ar: "المدفوعات", en: "Payments" },
  "/kitchen": { ar: "المطبخ", en: "Kitchen" },
  "/courier": { ar: "التوصيل", en: "Courier" },
  "/settings": { ar: "الإعدادات", en: "Settings" },
};

export function Header() {
  const location = useLocation();
  const currentPage = pageNames[location.pathname] || { ar: "لوحة التحكم", en: "Dashboard" };

  return (
    <header className="h-16 bg-white border-b border-[#E9ECEF] flex items-center px-6 gap-4">
      {/* Page Title */}
      <div className="flex-1">
        <h2 className="text-xl font-bold text-[#212529]" style={{ fontFamily: 'Cairo, sans-serif' }}>
          {currentPage.ar}
        </h2>
        <p className="text-xs text-[#6C757D]">{currentPage.en}</p>
      </div>

      {/* Search Bar */}
      <div className="relative w-80" dir="ltr">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6C757D]" />
        <Input
          type="text"
          placeholder="Search..."
          className="pl-10 bg-[#F8F9FA] border-[#E9ECEF] text-sm"
        />
      </div>

      {/* Notification */}
      <Button variant="ghost" size="icon" className="relative">
        <Bell className="w-5 h-5 text-[#6C757D]" />
        <span className="absolute top-1 right-1 w-2 h-2 bg-[#E63946] rounded-full" />
      </Button>

      {/* User Profile */}
      <div className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#F8F9FA]">
        <div className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
          <div className="text-sm font-medium text-[#212529]">أحمد محمد</div>
          <div className="text-xs text-[#6C757D]">مدير النظام</div>
        </div>
        <div className="w-9 h-9 bg-[#1B4332] rounded-full flex items-center justify-center text-white text-sm font-medium">
          أم
        </div>
      </div>

      {/* Logout */}
      <Button variant="ghost" size="icon">
        <LogOut className="w-5 h-5 text-[#6C757D]" />
      </Button>
    </header>
  );
}