import { useState } from "react";
import { useParams, Link } from "react-router";
import { ArrowRight, X, Plus } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../components/ui/alert-dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { toast } from "sonner";

const subscriptionDetails = {
  id: "SUB-001",
  plan: "Premium Monthly",
  status: "active",
  deliveryMode: "pickup",
  startDate: "2026-03-01",
  endDate: "2026-04-01",
  validityEndDate: "2026-04-15",
  totalMeals: 30,
  remainingMeals: 18,
  selectedGrams: 400,
  mealsPerDay: 1,
  user: {
    name: "أحمد محمد",
    phone: "+966501234567",
    email: "ahmed@example.com",
    active: true,
  },
};

const daysSchedule = [
  {
    date: "2026-03-10",
    status: "fulfilled",
    selections: "دجاج مشوي، أرز بسمتي",
  },
  {
    date: "2026-03-11",
    status: "out_for_delivery",
    selections: "سلمون، خضار مشكلة",
  },
  {
    date: "2026-03-12",
    status: "in_preparation",
    selections: "لحم بقري، بطاطا مهروسة",
  },
  {
    date: "2026-03-13",
    status: "locked",
    selections: "دجاج تيرياكي، أرز أبيض",
  },
  {
    date: "2026-03-14",
    status: "open",
    selections: "-",
  },
  {
    date: "2026-03-15",
    status: "open",
    selections: "-",
  },
  {
    date: "2026-03-16",
    status: "skipped",
    selections: "-",
  },
  {
    date: "2026-03-17",
    status: "frozen",
    selections: "-",
  },
];

const premiumBalance = [
  {
    mealName: "Premium Chicken",
    purchased: 10,
    remaining: 6,
    unitPrice: "25 ريال",
  },
  {
    mealName: "Premium Beef",
    purchased: 8,
    remaining: 4,
    unitPrice: "35 ريال",
  },
  {
    mealName: "Premium Fish",
    purchased: 12,
    remaining: 8,
    unitPrice: "30 ريال",
  },
];

const addonBalance = [
  {
    addonName: "Extra Protein",
    purchased: 5,
    remaining: 3,
    unitPrice: "10 ريال",
  },
  {
    addonName: "Side Salad",
    purchased: 6,
    remaining: 2,
    unitPrice: "8 ريال",
  },
];

const getStatusBadge = (status: string) => {
  const statusConfig: Record<string, { label: string; className: string }> = {
    active: { label: "نشط", className: "bg-[#2D6A4F] text-white" },
    pending: { label: "معلق", className: "bg-[#F4A261] text-white" },
    canceled: { label: "ملغي", className: "bg-[#E63946] text-white" },
    open: { label: "مفتوح", className: "bg-[#4361EE] text-white" },
    locked: { label: "مقفل", className: "bg-[#F4A261] text-white" },
    in_preparation: { label: "قيد التحضير", className: "bg-[#FFD166] text-gray-800" },
    out_for_delivery: { label: "قيد التوصيل", className: "bg-[#9D4EDD] text-white" },
    fulfilled: { label: "مكتمل", className: "bg-[#2D6A4F] text-white" },
    skipped: { label: "متخطى", className: "bg-[#6C757D] text-white" },
    frozen: { label: "مجمد", className: "bg-[#06B6D4] text-white" },
  };

  const config = statusConfig[status] || { label: status, className: "bg-gray-500 text-white" };
  return <Badge className={config.className}>{config.label}</Badge>;
};

const getDeliveryModeBadge = (mode: string) => {
  const modeConfig: Record<string, { label: string; className: string }> = {
    delivery: { label: "توصيل", className: "bg-[#4361EE] text-white" },
    pickup: { label: "استلام", className: "bg-[#40916C] text-white" },
  };

  const config = modeConfig[mode] || { label: mode, className: "" };
  return <Badge className={config.className}>{config.label}</Badge>;
};

export function SubscriptionDetails() {
  const { id } = useParams();
  const [isExtendDialogOpen, setIsExtendDialogOpen] = useState(false);
  const [extendDays, setExtendDays] = useState("");

  const handleCancel = () => {
    toast.success("تم إلغاء الاشتراك بنجاح");
  };

  const handleExtend = () => {
    toast.success(`تم تمديد الاشتراك لـ ${extendDays} يوم بنجاح`);
    setIsExtendDialogOpen(false);
    setExtendDays("");
  };

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-[#6C757D]">
        <Link to="/subscriptions" className="hover:text-[#1B4332]">
          الاشتراكات
        </Link>
        <span>/</span>
        <span className="text-[#212529] ltr">{subscriptionDetails.id}</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/subscriptions">
            <Button variant="ghost" size="icon">
              <ArrowRight className="w-5 h-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[#212529]">تفاصيل الاشتراك</h1>
            <p className="text-[#6C757D] mt-1 ltr">{subscriptionDetails.id}</p>
          </div>
        </div>
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Subscription Info */}
        <Card>
          <CardHeader>
            <CardTitle>معلومات الاشتراك</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-[#6C757D] ltr">Plan</label>
                <p className="font-medium text-[#212529] mt-1 ltr">
                  {subscriptionDetails.plan}
                </p>
              </div>
              <div>
                <label className="text-sm text-[#6C757D]">الحالة</label>
                <div className="mt-1">
                  {getStatusBadge(subscriptionDetails.status)}
                </div>
              </div>
              <div>
                <label className="text-sm text-[#6C757D]">طريقة التوصيل</label>
                <div className="mt-1">
                  {getDeliveryModeBadge(subscriptionDetails.deliveryMode)}
                </div>
              </div>
              <div>
                <label className="text-sm text-[#6C757D] ltr">Start Date</label>
                <p className="font-medium text-[#212529] mt-1 ltr">
                  {subscriptionDetails.startDate}
                </p>
              </div>
              <div>
                <label className="text-sm text-[#6C757D] ltr">End Date</label>
                <p className="font-medium text-[#212529] mt-1 ltr">
                  {subscriptionDetails.endDate}
                </p>
              </div>
              <div>
                <label className="text-sm text-[#6C757D] ltr">Validity End</label>
                <p className="font-medium text-[#212529] mt-1 ltr">
                  {subscriptionDetails.validityEndDate}
                </p>
              </div>
              <div>
                <label className="text-sm text-[#6C757D]">إجمالي الوجبات</label>
                <p className="font-medium text-[#212529] mt-1">
                  {subscriptionDetails.totalMeals}
                </p>
              </div>
              <div>
                <label className="text-sm text-[#6C757D]">الوجبات المتبقية</label>
                <p className="font-medium text-[#1B4332] mt-1">
                  {subscriptionDetails.remainingMeals}
                </p>
              </div>
              <div>
                <label className="text-sm text-[#6C757D] ltr">Selected Grams</label>
                <p className="font-medium text-[#212529] mt-1 ltr">
                  {subscriptionDetails.selectedGrams}g
                </p>
              </div>
              <div>
                <label className="text-sm text-[#6C757D] ltr">Meals Per Day</label>
                <p className="font-medium text-[#212529] mt-1">
                  {subscriptionDetails.mealsPerDay}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* User Info */}
        <Card>
          <CardHeader>
            <CardTitle>معلومات المستخدم</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm text-[#6C757D]">الاسم</label>
              <p className="font-medium text-[#212529] mt-1">
                {subscriptionDetails.user.name}
              </p>
            </div>
            <div>
              <label className="text-sm text-[#6C757D] ltr">Phone</label>
              <p className="font-medium text-[#212529] mt-1 ltr">
                {subscriptionDetails.user.phone}
              </p>
            </div>
            <div>
              <label className="text-sm text-[#6C757D] ltr">Email</label>
              <p className="font-medium text-[#212529] mt-1 ltr">
                {subscriptionDetails.user.email}
              </p>
            </div>
            <div>
              <label className="text-sm text-[#6C757D]">حالة الحساب</label>
              <div className="mt-1">
                {getStatusBadge(subscriptionDetails.user.active ? "active" : "inactive")}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-3">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive">
              <X className="ml-2 w-4 h-4" />
              إلغاء الاشتراك
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="rtl">
            <AlertDialogHeader>
              <AlertDialogTitle>إلغاء الاشتراك</AlertDialogTitle>
              <AlertDialogDescription>
                هل أنت متأكد من إلغاء هذا الاشتراك؟ هذا الإجراء لا يمكن التراجع عنه.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>تراجع</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleCancel}
                className="bg-[#E63946] hover:bg-[#D62839]"
              >
                إلغاء الاشتراك
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Dialog open={isExtendDialogOpen} onOpenChange={setIsExtendDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-[#1B4332] hover:bg-[#2D6A4F]">
              <Plus className="ml-2 w-4 h-4" />
              تمديد الاشتراك
            </Button>
          </DialogTrigger>
          <DialogContent className="rtl">
            <DialogHeader>
              <DialogTitle>تمديد الاشتراك</DialogTitle>
              <DialogDescription>
                أدخل عدد الأيام التي تريد تمديد الاشتراك بها
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Label htmlFor="days">عدد الأيام</Label>
              <Input
                id="days"
                type="number"
                placeholder="30"
                value={extendDays}
                onChange={(e) => setExtendDays(e.target.value)}
                className="mt-2"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsExtendDialogOpen(false)}>
                إلغاء
              </Button>
              <Button
                onClick={handleExtend}
                className="bg-[#1B4332] hover:bg-[#2D6A4F]"
              >
                تمديد
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="schedule" className="space-y-4">
        <TabsList className="rtl">
          <TabsTrigger value="schedule">جدول الأيام</TabsTrigger>
          <TabsTrigger value="wallet">المحفظة والرصيد</TabsTrigger>
        </TabsList>

        {/* Days Schedule Tab */}
        <TabsContent value="schedule">
          <Card>
            <CardHeader>
              <CardTitle>جدول الأيام والوجبات</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right ltr">Date</TableHead>
                    <TableHead className="text-right">الحالة</TableHead>
                    <TableHead className="text-right">الوجبات المختارة</TableHead>
                    <TableHead className="text-right">الإجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {daysSchedule.map((day) => (
                    <TableRow key={day.date}>
                      <TableCell className="font-medium ltr">{day.date}</TableCell>
                      <TableCell>{getStatusBadge(day.status)}</TableCell>
                      <TableCell>{day.selections}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost">
                          عرض التفاصيل
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Wallet & Credits Tab */}
        <TabsContent value="wallet" className="space-y-6">
          {/* Premium Balance */}
          <Card>
            <CardHeader>
              <CardTitle ltr>Premium Balance</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right ltr">Meal Name</TableHead>
                    <TableHead className="text-right">المشتراة</TableHead>
                    <TableHead className="text-right">المتبقية</TableHead>
                    <TableHead className="text-right ltr">Unit Price</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {premiumBalance.map((item) => (
                    <TableRow key={item.mealName}>
                      <TableCell className="font-medium ltr">{item.mealName}</TableCell>
                      <TableCell className="text-center">{item.purchased}</TableCell>
                      <TableCell className="text-center">{item.remaining}</TableCell>
                      <TableCell className="ltr">{item.unitPrice}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Addon Balance */}
          <Card>
            <CardHeader>
              <CardTitle ltr>Addon Balance</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right ltr">Addon Name</TableHead>
                    <TableHead className="text-right">المشتراة</TableHead>
                    <TableHead className="text-right">المتبقية</TableHead>
                    <TableHead className="text-right ltr">Unit Price</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {addonBalance.map((item) => (
                    <TableRow key={item.addonName}>
                      <TableCell className="font-medium ltr">{item.addonName}</TableCell>
                      <TableCell className="text-center">{item.purchased}</TableCell>
                      <TableCell className="text-center">{item.remaining}</TableCell>
                      <TableCell className="ltr">{item.unitPrice}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
