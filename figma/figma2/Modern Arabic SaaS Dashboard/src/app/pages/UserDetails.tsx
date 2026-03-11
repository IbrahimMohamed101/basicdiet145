import { useParams, Link } from "react-router";
import { ArrowRight, Eye, ToggleLeft } from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";

const userDetails = {
  id: "1",
  name: "أحمد محمد",
  phone: "+966501234567",
  email: "ahmed@example.com",
  active: true,
  createdAt: "2026-01-15",
  subscriptions: [
    {
      id: "SUB-001",
      plan: "Premium Monthly",
      status: "active",
      startDate: "2026-03-01",
      endDate: "2026-04-01",
      remainingMeals: 18,
      totalMeals: 30,
    },
    {
      id: "SUB-002",
      plan: "Standard Weekly",
      status: "active",
      startDate: "2026-02-15",
      endDate: "2026-03-15",
      remainingMeals: 5,
      totalMeals: 14,
    },
    {
      id: "SUB-003",
      plan: "Premium Weekly",
      status: "canceled",
      startDate: "2026-01-20",
      endDate: "2026-02-10",
      remainingMeals: 0,
      totalMeals: 21,
    },
  ],
};

const getStatusBadge = (status: string) => {
  const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
    active: { label: "نشط", variant: "default" },
    pending: { label: "معلق", variant: "secondary" },
    canceled: { label: "ملغي", variant: "destructive" },
  };

  const config = statusConfig[status] || { label: status, variant: "secondary" as const };
  return <Badge variant={config.variant}>{config.label}</Badge>;
};

export function UserDetails() {
  const { id } = useParams();

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-[#6C757D]">
        <Link to="/users" className="hover:text-[#1B4332]">
          مستخدمي التطبيق
        </Link>
        <span>/</span>
        <span className="text-[#212529]">{userDetails.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/users">
            <Button variant="ghost" size="icon">
              <ArrowRight className="w-5 h-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[#212529]">تفاصيل المستخدم</h1>
            <p className="text-[#6C757D] mt-1">معلومات واشتراكات المستخدم</p>
          </div>
        </div>
      </div>

      {/* User Profile Card */}
      <Card>
        <CardHeader>
          <CardTitle>معلومات المستخدم</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="text-sm text-[#6C757D]">الاسم</label>
              <p className="font-medium text-[#212529] mt-1">{userDetails.name}</p>
            </div>
            <div>
              <label className="text-sm text-[#6C757D] ltr">Phone</label>
              <p className="font-medium text-[#212529] mt-1 ltr">{userDetails.phone}</p>
            </div>
            <div>
              <label className="text-sm text-[#6C757D] ltr">Email</label>
              <p className="font-medium text-[#212529] mt-1 ltr">{userDetails.email}</p>
            </div>
            <div>
              <label className="text-sm text-[#6C757D]">الحالة</label>
              <div className="mt-1">
                {getStatusBadge(userDetails.active ? "active" : "inactive")}
              </div>
            </div>
            <div>
              <label className="text-sm text-[#6C757D] ltr">Created At</label>
              <p className="font-medium text-[#212529] mt-1 ltr">
                {userDetails.createdAt}
              </p>
            </div>
            <div className="flex items-end">
              <Button
                variant={userDetails.active ? "destructive" : "default"}
                className={!userDetails.active ? "bg-[#2D6A4F] hover:bg-[#1B4332]" : ""}
              >
                <ToggleLeft className="ml-2 w-4 h-4" />
                {userDetails.active ? "تعطيل الحساب" : "تفعيل الحساب"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Subscriptions Table */}
      <Card>
        <CardHeader>
          <CardTitle>اشتراكات المستخدم</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right ltr">ID</TableHead>
                <TableHead className="text-right ltr">Plan</TableHead>
                <TableHead className="text-right">الحالة</TableHead>
                <TableHead className="text-right ltr">Start Date</TableHead>
                <TableHead className="text-right ltr">End Date</TableHead>
                <TableHead className="text-right">الوجبات المتبقية</TableHead>
                <TableHead className="text-right">الإجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {userDetails.subscriptions.map((sub) => (
                <TableRow key={sub.id}>
                  <TableCell className="font-medium ltr">{sub.id}</TableCell>
                  <TableCell className="ltr">{sub.plan}</TableCell>
                  <TableCell>{getStatusBadge(sub.status)}</TableCell>
                  <TableCell className="ltr">{sub.startDate}</TableCell>
                  <TableCell className="ltr">{sub.endDate}</TableCell>
                  <TableCell className="text-center">
                    {sub.remainingMeals} / {sub.totalMeals}
                  </TableCell>
                  <TableCell>
                    <Link to={`/subscriptions/${sub.id}`}>
                      <Button size="sm" variant="ghost">
                        <Eye className="w-4 h-4 ml-1" />
                        عرض
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
