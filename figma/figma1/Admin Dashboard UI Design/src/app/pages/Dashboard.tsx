import { Users, ShoppingCart, Package, TrendingUp, Calendar } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { Badge } from "../components/ui/badge";

const stats = [
  {
    title: "إجمالي الطلبات",
    titleEn: "Total Orders",
    value: "1,234",
    change: "+12.5%",
    icon: ShoppingCart,
    color: "text-[#4361EE]",
    bgColor: "bg-[#4361EE]/10",
  },
  {
    title: "الاشتراكات النشطة",
    titleEn: "Active Subscriptions",
    value: "856",
    change: "+8.3%",
    icon: Users,
    color: "text-[#2D6A4F]",
    bgColor: "bg-[#2D6A4F]/10",
  },
  {
    title: "إيرادات الشهر",
    titleEn: "Monthly Revenue",
    value: "45,230 ر.س",
    change: "+15.2%",
    icon: TrendingUp,
    color: "text-[#40916C]",
    bgColor: "bg-[#40916C]/10",
  },
  {
    title: "الوجبات اليوم",
    titleEn: "Today's Meals",
    value: "342",
    change: "+5.1%",
    icon: Package,
    color: "text-[#F4A261]",
    bgColor: "bg-[#F4A261]/10",
  },
];

const recentOrders = [
  {
    id: "ORD-2024-0145",
    customer: "محمد أحمد",
    amount: "150.00",
    status: "delivered",
    date: "منذ ساعة",
  },
  {
    id: "ORD-2024-0144",
    customer: "فاطمة علي",
    amount: "125.00",
    status: "out_for_delivery",
    date: "منذ ساعتين",
  },
  {
    id: "ORD-2024-0143",
    customer: "خالد محمود",
    amount: "180.00",
    status: "preparing",
    date: "منذ 3 ساعات",
  },
  {
    id: "ORD-2024-0142",
    customer: "سارة حسن",
    amount: "140.00",
    status: "confirmed",
    date: "منذ 4 ساعات",
  },
];

const statusLabels: Record<string, { ar: string; color: string }> = {
  delivered: { ar: "تم التوصيل", color: "bg-[#2D6A4F]" },
  out_for_delivery: { ar: "في الطريق", color: "bg-[#9B59B6]" },
  preparing: { ar: "قيد التحضير", color: "bg-[#F4A261]" },
  confirmed: { ar: "مؤكد", color: "bg-[#4361EE]" },
};

export function Dashboard() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[#212529]" style={{ fontFamily: 'Cairo, sans-serif' }}>
          لوحة التحكم
        </h1>
        <p className="text-sm text-[#6C757D]">نظرة عامة على النظام</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, index) => (
          <Card key={index}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="text-sm font-medium text-[#6C757D]" style={{ fontFamily: 'Cairo, sans-serif' }}>
                  {stat.title}
                </CardTitle>
                <p className="text-xs text-[#6C757D]">{stat.titleEn}</p>
              </div>
              <div className={`w-10 h-10 ${stat.bgColor} rounded-lg flex items-center justify-center`}>
                <stat.icon className={`w-5 h-5 ${stat.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2">
                <div className="text-2xl font-bold">{stat.value}</div>
                <span className="text-sm text-[#2D6A4F]">{stat.change}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recent Orders */}
      <Card>
        <CardHeader>
          <CardTitle style={{ fontFamily: 'Cairo, sans-serif' }}>أحدث الطلبات</CardTitle>
          <p className="text-sm text-[#6C757D]">Recent Orders</p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="bg-[#F8F9FA]">
                <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                  رقم الطلب
                </TableHead>
                <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                  العميل
                </TableHead>
                <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                  المبلغ
                </TableHead>
                <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                  الحالة
                </TableHead>
                <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                  الوقت
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentOrders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="font-medium">{order.id}</TableCell>
                  <TableCell style={{ fontFamily: 'Cairo, sans-serif' }}>{order.customer}</TableCell>
                  <TableCell>
                    <span className="font-medium">{order.amount}</span>
                    <span className="text-xs text-[#6C757D] mr-1">ريال</span>
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={`${statusLabels[order.status].color} hover:${
                        statusLabels[order.status].color
                      } text-white`}
                    >
                      {statusLabels[order.status].ar}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-[#6C757D]" style={{ fontFamily: 'Cairo, sans-serif' }}>
                    {order.date}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-gradient-to-br from-[#1B4332] to-[#2D6A4F] text-white">
          <CardHeader>
            <CardTitle className="flex items-center gap-2" style={{ fontFamily: 'Cairo, sans-serif' }}>
              <Calendar className="w-5 h-5" />
              مهام اليوم
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">23</p>
            <p className="text-sm text-white/70">Today's Tasks</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-[#40916C] to-[#2D6A4F] text-white">
          <CardHeader>
            <CardTitle className="flex items-center gap-2" style={{ fontFamily: 'Cairo, sans-serif' }}>
              <Package className="w-5 h-5" />
              قيد التحضير
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">15</p>
            <p className="text-sm text-white/70">In Preparation</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-[#4361EE] to-[#6B7FEE] text-white">
          <CardHeader>
            <CardTitle className="flex items-center gap-2" style={{ fontFamily: 'Cairo, sans-serif' }}>
              <ShoppingCart className="w-5 h-5" />
              في الطريق
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">8</p>
            <p className="text-sm text-white/70">Out for Delivery</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
