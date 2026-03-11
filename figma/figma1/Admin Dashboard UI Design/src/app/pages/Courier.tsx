import { useState } from "react";
import { CheckCircle, XCircle, Clock } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";

interface SubscriptionDelivery {
  id: string;
  userName: string;
  address: string;
  window: string;
  status: "pending" | "out_for_delivery" | "delivered" | "canceled";
  eta: string;
}

interface OneTimeDelivery {
  id: string;
  userName: string;
  address: string;
  window: string;
  status: "pending" | "out_for_delivery" | "delivered" | "canceled";
}

const mockSubscriptionDeliveries: SubscriptionDelivery[] = [
  {
    id: "DEL-001",
    userName: "محمد أحمد",
    address: "شارع الملك فهد، الرياض",
    window: "12:00 - 14:00",
    status: "pending",
    eta: "13:30",
  },
  {
    id: "DEL-002",
    userName: "فاطمة علي",
    address: "حي النخيل، جدة",
    window: "14:00 - 16:00",
    status: "out_for_delivery",
    eta: "14:45",
  },
  {
    id: "DEL-003",
    userName: "خالد محمود",
    address: "شارع التحلية، الخبر",
    window: "16:00 - 18:00",
    status: "delivered",
    eta: "-",
  },
];

const mockOneTimeDeliveries: OneTimeDelivery[] = [
  {
    id: "ORD-2024-0001",
    userName: "عبدالله عمر",
    address: "طريق الأمير محمد، الدمام",
    window: "12:00 - 14:00",
    status: "pending",
  },
  {
    id: "ORD-2024-0002",
    userName: "نورة سالم",
    address: "حي الياسمين، الرياض",
    window: "14:00 - 16:00",
    status: "out_for_delivery",
  },
];

const statusLabels: Record<SubscriptionDelivery["status"], { ar: string; color: string }> = {
  pending: { ar: "قيد الانتظار", color: "bg-[#6C757D]" },
  out_for_delivery: { ar: "في الطريق", color: "bg-[#9B59B6]" },
  delivered: { ar: "تم التوصيل", color: "bg-[#2D6A4F]" },
  canceled: { ar: "ملغي", color: "bg-[#E63946]" },
};

export function Courier() {
  const [subscriptionDeliveries, setSubscriptionDeliveries] = useState(mockSubscriptionDeliveries);
  const [oneTimeDeliveries, setOneTimeDeliveries] = useState(mockOneTimeDeliveries);

  const handleSubDeliveryStatusChange = (
    id: string,
    newStatus: SubscriptionDelivery["status"]
  ) => {
    setSubscriptionDeliveries(
      subscriptionDeliveries.map((delivery) =>
        delivery.id === id ? { ...delivery, status: newStatus } : delivery
      )
    );
  };

  const handleOneTimeDeliveryStatusChange = (
    id: string,
    newStatus: OneTimeDelivery["status"]
  ) => {
    setOneTimeDeliveries(
      oneTimeDeliveries.map((delivery) =>
        delivery.id === id ? { ...delivery, status: newStatus } : delivery
      )
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#212529]" style={{ fontFamily: 'Cairo, sans-serif' }}>
            التوصيل
          </h1>
          <p className="text-sm text-[#6C757D]">إدارة التوصيلات اليومية</p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="subscriptions" className="space-y-4">
        <TabsList className="bg-white border border-[#E9ECEF]">
          <TabsTrigger value="subscriptions" style={{ fontFamily: 'Cairo, sans-serif' }}>
            توصيلات الاشتراكات
          </TabsTrigger>
          <TabsTrigger value="onetime" style={{ fontFamily: 'Cairo, sans-serif' }}>
            الطلبات لمرة واحدة
          </TabsTrigger>
        </TabsList>

        {/* Subscription Deliveries Tab */}
        <TabsContent value="subscriptions">
          <div className="bg-white rounded-lg border border-[#E9ECEF]">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#F8F9FA]">
                  <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                    رقم التوصيل
                  </TableHead>
                  <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                    اسم المستخدم
                  </TableHead>
                  <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                    العنوان
                  </TableHead>
                  <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                    الوقت
                  </TableHead>
                  <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                    الحالة
                  </TableHead>
                  <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                    الوقت المتوقع
                  </TableHead>
                  <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                    إجراءات
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subscriptionDeliveries.map((delivery) => (
                  <TableRow key={delivery.id}>
                    <TableCell className="font-medium">{delivery.id}</TableCell>
                    <TableCell style={{ fontFamily: 'Cairo, sans-serif' }}>
                      {delivery.userName}
                    </TableCell>
                    <TableCell style={{ fontFamily: 'Cairo, sans-serif' }}>
                      {delivery.address}
                    </TableCell>
                    <TableCell>{delivery.window}</TableCell>
                    <TableCell>
                      <Badge
                        className={`${statusLabels[delivery.status].color} hover:${
                          statusLabels[delivery.status].color
                        } text-white`}
                      >
                        {statusLabels[delivery.status].ar}
                      </Badge>
                    </TableCell>
                    <TableCell>{delivery.eta}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {delivery.status === "pending" && (
                          <Button
                            size="sm"
                            onClick={() =>
                              handleSubDeliveryStatusChange(delivery.id, "out_for_delivery")
                            }
                            className="bg-[#F4A261] hover:bg-[#F4A261]/90"
                          >
                            <Clock className="w-3 h-3 ml-1" />
                            في الطريق
                          </Button>
                        )}
                        {delivery.status === "out_for_delivery" && (
                          <>
                            <Button
                              size="sm"
                              onClick={() =>
                                handleSubDeliveryStatusChange(delivery.id, "delivered")
                              }
                              className="bg-[#2D6A4F] hover:bg-[#2D6A4F]/90"
                            >
                              <CheckCircle className="w-3 h-3 ml-1" />
                              تم التوصيل
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() =>
                                handleSubDeliveryStatusChange(delivery.id, "canceled")
                              }
                              className="bg-[#E63946] hover:bg-[#E63946]/90"
                            >
                              <XCircle className="w-3 h-3 ml-1" />
                              إلغاء
                            </Button>
                          </>
                        )}
                        {delivery.status === "delivered" && (
                          <Badge className="bg-[#2D6A4F] hover:bg-[#2D6A4F]">
                            مكتمل
                          </Badge>
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
                    العنوان
                  </TableHead>
                  <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                    الوقت
                  </TableHead>
                  <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                    الحالة
                  </TableHead>
                  <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                    إجراءات
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {oneTimeDeliveries.map((delivery) => (
                  <TableRow key={delivery.id}>
                    <TableCell className="font-medium">{delivery.id}</TableCell>
                    <TableCell style={{ fontFamily: 'Cairo, sans-serif' }}>
                      {delivery.userName}
                    </TableCell>
                    <TableCell style={{ fontFamily: 'Cairo, sans-serif' }}>
                      {delivery.address}
                    </TableCell>
                    <TableCell>{delivery.window}</TableCell>
                    <TableCell>
                      <Badge
                        className={`${statusLabels[delivery.status].color} hover:${
                          statusLabels[delivery.status].color
                        } text-white`}
                      >
                        {statusLabels[delivery.status].ar}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {delivery.status === "pending" && (
                          <Button
                            size="sm"
                            onClick={() =>
                              handleOneTimeDeliveryStatusChange(delivery.id, "out_for_delivery")
                            }
                            className="bg-[#F4A261] hover:bg-[#F4A261]/90"
                          >
                            <Clock className="w-3 h-3 ml-1" />
                            في الطريق
                          </Button>
                        )}
                        {delivery.status === "out_for_delivery" && (
                          <>
                            <Button
                              size="sm"
                              onClick={() =>
                                handleOneTimeDeliveryStatusChange(delivery.id, "delivered")
                              }
                              className="bg-[#2D6A4F] hover:bg-[#2D6A4F]/90"
                            >
                              <CheckCircle className="w-3 h-3 ml-1" />
                              تم التوصيل
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() =>
                                handleOneTimeDeliveryStatusChange(delivery.id, "canceled")
                              }
                              className="bg-[#E63946] hover:bg-[#E63946]/90"
                            >
                              <XCircle className="w-3 h-3 ml-1" />
                              إلغاء
                            </Button>
                          </>
                        )}
                        {delivery.status === "delivered" && (
                          <Badge className="bg-[#2D6A4F] hover:bg-[#2D6A4F]">
                            مكتمل
                          </Badge>
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
    </div>
  );
}
