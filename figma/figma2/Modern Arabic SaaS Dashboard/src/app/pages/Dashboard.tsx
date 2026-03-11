import { Users, Package, ShoppingCart, Smartphone, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { Link } from "react-router";

const stats = [
  {
    title: "إجمالي الاشتراكات النشطة",
    value: "1,247",
    icon: Package,
    color: "bg-[#1B4332]",
  },
  {
    title: "توصيلات اليوم",
    value: "342",
    icon: ShoppingCart,
    color: "bg-[#40916C]",
  },
  {
    title: "الطلبات المعلقة",
    value: "28",
    icon: AlertTriangle,
    color: "bg-[#F4A261]",
  },
  {
    title: "إجمالي مستخدمي التطبيق",
    value: "3,458",
    icon: Smartphone,
    color: "bg-[#4361EE]",
  },
];

const recentSubscriptions = [
  {
    id: "1",
    user: "أحمد محمد",
    plan: "Premium Monthly",
    status: "active",
    startDate: "2026-03-01",
    amount: "500 ريال",
  },
  {
    id: "2",
    user: "فاطمة علي",
    plan: "Standard Weekly",
    status: "pending",
    startDate: "2026-03-10",
    amount: "200 ريال",
  },
  {
    id: "3",
    user: "عمر خالد",
    plan: "Premium Weekly",
    status: "active",
    startDate: "2026-03-08",
    amount: "350 ريال",
  },
  {
    id: "4",
    user: "سارة حسن",
    plan: "Standard Monthly",
    status: "active",
    startDate: "2026-03-05",
    amount: "400 ریال",
  },
  {
    id: "5",
    user: "محمد عبدالله",
    plan: "Premium Monthly",
    status: "pending",
    startDate: "2026-03-09",
    amount: "500 ريال",
  },
];

const recentOrders = [
  {
    id: "ORD-001",
    user: "أحمد محمد",
    items: "دجاج مشوي، أرز بسمتي",
    status: "out_for_delivery",
    date: "2026-03-10",
  },
  {
    id: "ORD-002",
    user: "فاطمة علي",
    items: "سلمون، خضار مشكلة",
    status: "in_preparation",
    date: "2026-03-10",
  },
  {
    id: "ORD-003",
    user: "عمر خالد",
    items: "لحم بقري، بطاطا مهروسة",
    status: "fulfilled",
    date: "2026-03-10",
  },
  {
    id: "ORD-004",
    user: "سارة حسن",
    items: "دجاج تيرياكي، أرز أبيض",
    status: "in_preparation",
    date: "2026-03-10",
  },
  {
    id: "ORD-005",
    user: "محمد عبدالله",
    items: "سمك مشوي، سلطة يونانية",
    status: "pending",
    date: "2026-03-10",
  },
];

const getStatusBadge = (status: string) => {
  const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    active: { label: "نشط", variant: "default" },
    pending: { label: "معلق", variant: "secondary" },
    canceled: { label: "ملغي", variant: "destructive" },
    out_for_delivery: { label: "قيد التوصيل", variant: "default" },
    in_preparation: { label: "قيد التحضير", variant: "secondary" },
    fulfilled: { label: "مكتمل", variant: "outline" },
  };

  const config = statusConfig[status] || { label: status, variant: "outline" as const };
  return <Badge variant={config.variant}>{config.label}</Badge>;
};

export function Dashboard() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#212529]">لوحة التحكم</h1>
        <p className="text-[#6C757D] mt-1">نظرة عامة على النظام</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.title}>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-[#6C757D] mb-1">{stat.title}</p>
                    <p className="text-3xl font-bold text-[#212529]">{stat.value}</p>
                  </div>
                  <div className={`${stat.color} p-3 rounded-lg`}>
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Subscriptions */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>الاشتراكات الأخيرة</CardTitle>
            <Link to="/subscriptions">
              <Button variant="ghost" size="sm">
                عرض الكل
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">المستخدم</TableHead>
                  <TableHead className="text-right ltr">Plan</TableHead>
                  <TableHead className="text-right">الحالة</TableHead>
                  <TableHead className="text-right">تاريخ البدء</TableHead>
                  <TableHead className="text-right">المبلغ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentSubscriptions.map((sub) => (
                  <TableRow key={sub.id}>
                    <TableCell className="font-medium">{sub.user}</TableCell>
                    <TableCell className="ltr">{sub.plan}</TableCell>
                    <TableCell>{getStatusBadge(sub.status)}</TableCell>
                    <TableCell className="ltr">{sub.startDate}</TableCell>
                    <TableCell>{sub.amount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle>إجراءات سريعة</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button className="w-full bg-[#1B4332] hover:bg-[#2D6A4F]">
              إضافة اشتراك جديد
            </Button>
            <Button className="w-full" variant="outline">
              إضافة مستخدم
            </Button>
            <Button className="w-full" variant="outline">
              عرض التقارير
            </Button>
            <Button
              className="w-full bg-[#E63946] hover:bg-[#D62839] text-white"
            >
              <AlertTriangle className="ml-2 w-4 h-4" />
              تشغيل Cutoff Job
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Recent Orders */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>الطلبات الأخيرة</CardTitle>
          <Button variant="ghost" size="sm">
            عرض الكل
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right ltr">ID</TableHead>
                <TableHead className="text-right">المستخدم</TableHead>
                <TableHead className="text-right">الوجبات</TableHead>
                <TableHead className="text-right">الحالة</TableHead>
                <TableHead className="text-right">التاريخ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentOrders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="font-medium ltr">{order.id}</TableCell>
                  <TableCell>{order.user}</TableCell>
                  <TableCell className="max-w-xs truncate">{order.items}</TableCell>
                  <TableCell>{getStatusBadge(order.status)}</TableCell>
                  <TableCell className="ltr">{order.date}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
