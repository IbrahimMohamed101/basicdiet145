import { useState } from "react";
import { Calendar, Lock, Unlock, ChefHat, Truck, Package } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";

interface SubscriptionDay {
  id: number;
  subscriptionId: string;
  userName: string;
  status: "open" | "locked" | "in_preparation" | "out_for_delivery" | "ready_for_pickup" | "fulfilled" | "skipped";
  selections: string;
  deliveryMode: "delivery" | "pickup";
}

interface OneTimeOrder {
  id: string;
  userName: string;
  items: string;
  status: "confirmed" | "preparing" | "out_for_delivery" | "ready_for_pickup" | "fulfilled";
  deliveryMode: "delivery" | "pickup";
}

const mockSubscriptionDays: SubscriptionDay[] = [
  {
    id: 1,
    subscriptionId: "SUB-001",
    userName: "محمد أحمد",
    status: "open",
    selections: "لم يتم التحديد",
    deliveryMode: "delivery",
  },
  {
    id: 2,
    subscriptionId: "SUB-002",
    userName: "فاطمة علي",
    status: "locked",
    selections: "دجاج مشوي، سلطة",
    deliveryMode: "pickup",
  },
  {
    id: 3,
    subscriptionId: "SUB-003",
    userName: "خالد محمود",
    status: "in_preparation",
    selections: "سمك مشوي، خضار",
    deliveryMode: "delivery",
  },
  {
    id: 4,
    subscriptionId: "SUB-004",
    userName: "سارة حسن",
    status: "out_for_delivery",
    selections: "لحم بقري، أرز",
    deliveryMode: "delivery",
  },
];

const mockOneTimeOrders: OneTimeOrder[] = [
  {
    id: "ORD-2024-0001",
    userName: "عبدالله عمر",
    items: "وجبة بريميوم × 2",
    status: "confirmed",
    deliveryMode: "delivery",
  },
  {
    id: "ORD-2024-0002",
    userName: "نورة سالم",
    items: "إضافة بروتين، سموثي",
    status: "preparing",
    deliveryMode: "pickup",
  },
];

const statusLabels: Record<SubscriptionDay["status"], { ar: string; color: string }> = {
  open: { ar: "مفتوح", color: "bg-[#4361EE]" },
  frozen: { ar: "مجمد", color: "bg-[#87CEEB]" },
  locked: { ar: "مقفل", color: "bg-[#F4A261]" },
  in_preparation: { ar: "قيد التحضير", color: "bg-[#F4A261]" },
  out_for_delivery: { ar: "في الطريق", color: "bg-[#9B59B6]" },
  ready_for_pickup: { ar: "جاهز للاستلام", color: "bg-[#20B2AA]" },
  fulfilled: { ar: "مكتمل", color: "bg-[#2D6A4F]" },
  skipped: { ar: "متخطى", color: "bg-[#6C757D]" },
};

const orderStatusLabels: Record<OneTimeOrder["status"], { ar: string; color: string }> = {
  confirmed: { ar: "مؤكد", color: "bg-[#4361EE]" },
  preparing: { ar: "قيد التحضير", color: "bg-[#F4A261]" },
  out_for_delivery: { ar: "في الطريق", color: "bg-[#9B59B6]" },
  ready_for_pickup: { ar: "جاهز للاستلام", color: "bg-[#20B2AA]" },
  fulfilled: { ar: "مكتمل", color: "bg-[#2D6A4F]" },
};

export function Kitchen() {
  const [subscriptionDays, setSubscriptionDays] = useState(mockSubscriptionDays);
  const [oneTimeOrders, setOneTimeOrders] = useState(mockOneTimeOrders);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [selectedSub, setSelectedSub] = useState<SubscriptionDay | null>(null);

  const handleStatusChange = (id: number, newStatus: SubscriptionDay["status"]) => {
    setSubscriptionDays(
      subscriptionDays.map((day) => (day.id === id ? { ...day, status: newStatus } : day))
    );
  };

  const handleOrderStatusChange = (id: string, newStatus: OneTimeOrder["status"]) => {
    setOneTimeOrders(
      oneTimeOrders.map((order) => (order.id === id ? { ...order, status: newStatus } : order))
    );
  };

  const handleBulkLockAll = () => {
    if (confirm("هل أنت متأكد من قفل جميع الأيام؟")) {
      setSubscriptionDays(
        subscriptionDays.map((day) => ({
          ...day,
          status: day.status === "open" ? "locked" : day.status,
        }))
      );
    }
  };

  const openAssignModal = (sub: SubscriptionDay) => {
    setSelectedSub(sub);
    setIsAssignModalOpen(true);
  };

  const lockedCount = subscriptionDays.filter((d) => d.status === "locked").length;
  const skippedCount = subscriptionDays.filter((d) => d.status === "skipped").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#212529]" style={{ fontFamily: 'Cairo, sans-serif' }}>
            المطبخ
          </h1>
          <p className="text-sm text-[#6C757D]">إدارة التحضير والتوصيل</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Badge className="bg-[#2D6A4F] hover:bg-[#2D6A4F]">
              {lockedCount} مقفل
            </Badge>
            <Badge className="bg-[#6C757D] hover:bg-[#6C757D]">
              {skippedCount} متخطى
            </Badge>
          </div>
        </div>
      </div>

      {/* Top Bar */}
      <div className="bg-white p-4 rounded-lg border border-[#E9ECEF] flex gap-4 items-center justify-between">
        <div className="flex items-center gap-3">
          <Calendar className="w-5 h-5 text-[#6C757D]" />
          <Input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="w-48"
          />
        </div>
        <Button
          variant="destructive"
          onClick={handleBulkLockAll}
          className="bg-[#E63946] hover:bg-[#E63946]/90"
        >
          <Lock className="w-4 h-4 ml-2" />
          قفل جميع الأيام
        </Button>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="subscriptions" className="space-y-4">
        <TabsList className="bg-white border border-[#E9ECEF]">
          <TabsTrigger value="subscriptions" style={{ fontFamily: 'Cairo, sans-serif' }}>
            أيام الاشتراكات
          </TabsTrigger>
          <TabsTrigger value="onetime" style={{ fontFamily: 'Cairo, sans-serif' }}>
            الطلبات لمرة واحدة
          </TabsTrigger>
        </TabsList>

        {/* Subscription Days Tab */}
        <TabsContent value="subscriptions">
          <div className="bg-white rounded-lg border border-[#E9ECEF]">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#F8F9FA]">
                  <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                    رقم الاشتراك
                  </TableHead>
                  <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                    اسم المستخدم
                  </TableHead>
                  <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                    الحالة
                  </TableHead>
                  <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                    الاختيارات
                  </TableHead>
                  <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                    طريقة التوصيل
                  </TableHead>
                  <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                    إجراءات
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subscriptionDays.map((day) => (
                  <TableRow key={day.id}>
                    <TableCell className="font-medium">{day.subscriptionId}</TableCell>
                    <TableCell style={{ fontFamily: 'Cairo, sans-serif' }}>{day.userName}</TableCell>
                    <TableCell>
                      <Badge
                        className={`${statusLabels[day.status].color} hover:${
                          statusLabels[day.status].color
                        } text-white`}
                      >
                        {statusLabels[day.status].ar}
                      </Badge>
                    </TableCell>
                    <TableCell style={{ fontFamily: 'Cairo, sans-serif' }}>
                      {day.selections}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" style={{ fontFamily: 'Cairo, sans-serif' }}>
                        {day.deliveryMode === "delivery" ? "توصيل" : "استلام"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {day.status === "open" && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openAssignModal(day)}
                              className="text-[#4361EE] border-[#4361EE] hover:bg-[#4361EE]/10"
                            >
                              تعيين وجبات
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => handleStatusChange(day.id, "locked")}
                              className="bg-[#F4A261] hover:bg-[#F4A261]/90"
                            >
                              <Lock className="w-3 h-3 ml-1" />
                              قفل
                            </Button>
                          </>
                        )}
                        {day.status === "locked" && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleStatusChange(day.id, "open")}
                            >
                              <Unlock className="w-3 h-3 ml-1" />
                              إعادة فتح
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => handleStatusChange(day.id, "in_preparation")}
                              className="bg-[#40916C] hover:bg-[#40916C]/90"
                            >
                              <ChefHat className="w-3 h-3 ml-1" />
                              قيد التحضير
                            </Button>
                          </>
                        )}
                        {day.status === "in_preparation" && (
                          <>
                            {day.deliveryMode === "delivery" ? (
                              <Button
                                size="sm"
                                onClick={() => handleStatusChange(day.id, "out_for_delivery")}
                                className="bg-[#9B59B6] hover:bg-[#9B59B6]/90"
                              >
                                <Truck className="w-3 h-3 ml-1" />
                                في الطريق
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                onClick={() => handleStatusChange(day.id, "ready_for_pickup")}
                                className="bg-[#20B2AA] hover:bg-[#20B2AA]/90"
                              >
                                <Package className="w-3 h-3 ml-1" />
                                جاهز للاستلام
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* One-Time Orders Tab */}
        <TabsContent value="onetime">
          <div className="bg-white rounded-lg border border-[#E9ECEF]">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#F8F9FA]">
                  <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                    رقم الطلب
                  </TableHead>
                  <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                    المستخدم
                  </TableHead>
                  <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                    العناصر
                  </TableHead>
                  <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                    الحالة
                  </TableHead>
                  <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                    طريقة التوصيل
                  </TableHead>
                  <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                    إجراءات
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {oneTimeOrders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-medium">{order.id}</TableCell>
                    <TableCell style={{ fontFamily: 'Cairo, sans-serif' }}>
                      {order.userName}
                    </TableCell>
                    <TableCell style={{ fontFamily: 'Cairo, sans-serif' }}>{order.items}</TableCell>
                    <TableCell>
                      <Badge
                        className={`${orderStatusLabels[order.status].color} hover:${
                          orderStatusLabels[order.status].color
                        } text-white`}
                      >
                        {orderStatusLabels[order.status].ar}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" style={{ fontFamily: 'Cairo, sans-serif' }}>
                        {order.deliveryMode === "delivery" ? "توصيل" : "استلام"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {order.status === "confirmed" && (
                          <Button
                            size="sm"
                            onClick={() => handleOrderStatusChange(order.id, "preparing")}
                            className="bg-[#40916C] hover:bg-[#40916C]/90"
                          >
                            <ChefHat className="w-3 h-3 ml-1" />
                            قيد التحضير
                          </Button>
                        )}
                        {order.status === "preparing" && (
                          <>
                            {order.deliveryMode === "delivery" ? (
                              <Button
                                size="sm"
                                onClick={() => handleOrderStatusChange(order.id, "out_for_delivery")}
                                className="bg-[#9B59B6] hover:bg-[#9B59B6]/90"
                              >
                                <Truck className="w-3 h-3 ml-1" />
                                في الطريق
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                onClick={() => handleOrderStatusChange(order.id, "ready_for_pickup")}
                                className="bg-[#20B2AA] hover:bg-[#20B2AA]/90"
                              >
                                <Package className="w-3 h-3 ml-1" />
                                جاهز للاستلام
                              </Button>
                            )}
                            <Button
                              size="sm"
                              onClick={() => handleOrderStatusChange(order.id, "fulfilled")}
                              className="bg-[#2D6A4F] hover:bg-[#2D6A4F]/90"
                            >
                              مكتمل
                            </Button>
                          </>
                        )}
                        {order.status === "ready_for_pickup" && (
                          <Button
                            size="sm"
                            onClick={() => handleOrderStatusChange(order.id, "fulfilled")}
                            className="bg-[#2D6A4F] hover:bg-[#2D6A4F]/90"
                          >
                            مكتمل
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      {/* Assign Meals Modal */}
      <Dialog open={isAssignModalOpen} onOpenChange={setIsAssignModalOpen}>
        <DialogContent className="max-w-2xl" dir="rtl">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: 'Cairo, sans-serif' }}>تعيين الوجبات</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-4 bg-[#F8F9FA] rounded-lg">
              <p className="text-sm text-[#6C757D]">الاشتراك</p>
              <p className="font-medium" style={{ fontFamily: 'Cairo, sans-serif' }}>
                {selectedSub?.subscriptionId} - {selectedSub?.userName}
              </p>
            </div>
            <div className="space-y-2">
              <Label style={{ fontFamily: 'Cairo, sans-serif' }}>اختيارات الوجبات العادية</Label>
              <Input placeholder="حدد الوجبات العادية..." />
            </div>
            <div className="space-y-2">
              <Label style={{ fontFamily: 'Cairo, sans-serif' }}>اختيارات الوجبات البريميوم</Label>
              <Input placeholder="حدد الوجبات البريميوم..." />
            </div>
            <div className="flex gap-3 justify-end pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsAssignModalOpen(false)}
              >
                إلغاء
              </Button>
              <Button
                type="submit"
                className="bg-[#1B4332] hover:bg-[#2D6A4F]"
                onClick={() => setIsAssignModalOpen(false)}
              >
                حفظ
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
