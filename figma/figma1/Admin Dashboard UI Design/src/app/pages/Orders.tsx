import { useState } from "react";
import { Eye, Calendar } from "lucide-react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "../components/ui/pagination";
import { Input } from "../components/ui/input";

interface Order {
  id: string;
  userName: string;
  status: "pending" | "confirmed" | "preparing" | "out_for_delivery" | "delivered" | "canceled";
  deliveryMode: "delivery" | "pickup";
  deliveryDate: string;
  total: number;
  paymentStatus: "paid" | "pending" | "failed";
}

const mockOrders: Order[] = [
  {
    id: "ORD-2024-0001",
    userName: "محمد أحمد",
    status: "confirmed",
    deliveryMode: "delivery",
    deliveryDate: "2024-03-12",
    total: 15000,
    paymentStatus: "paid",
  },
  {
    id: "ORD-2024-0002",
    userName: "فاطمة علي",
    status: "preparing",
    deliveryMode: "pickup",
    deliveryDate: "2024-03-11",
    total: 12500,
    paymentStatus: "paid",
  },
  {
    id: "ORD-2024-0003",
    userName: "خالد محمود",
    status: "out_for_delivery",
    deliveryMode: "delivery",
    deliveryDate: "2024-03-11",
    total: 18000,
    paymentStatus: "paid",
  },
  {
    id: "ORD-2024-0004",
    userName: "سارة حسن",
    status: "pending",
    deliveryMode: "delivery",
    deliveryDate: "2024-03-13",
    total: 14000,
    paymentStatus: "pending",
  },
  {
    id: "ORD-2024-0005",
    userName: "عبدالله عمر",
    status: "delivered",
    deliveryMode: "delivery",
    deliveryDate: "2024-03-10",
    total: 16500,
    paymentStatus: "paid",
  },
  {
    id: "ORD-2024-0006",
    userName: "نورة سالم",
    status: "canceled",
    deliveryMode: "pickup",
    deliveryDate: "2024-03-09",
    total: 11000,
    paymentStatus: "failed",
  },
];

const statusLabels: Record<Order["status"], { ar: string; color: string }> = {
  pending: { ar: "قيد الانتظار", color: "bg-[#F4A261]" },
  confirmed: { ar: "مؤكد", color: "bg-[#4361EE]" },
  preparing: { ar: "قيد التحضير", color: "bg-[#40916C]" },
  out_for_delivery: { ar: "في الطريق", color: "bg-[#2D6A4F]" },
  delivered: { ar: "تم التوصيل", color: "bg-[#2D6A4F]" },
  canceled: { ar: "ملغي", color: "bg-[#6C757D]" },
};

const paymentStatusLabels: Record<Order["paymentStatus"], { ar: string; color: string }> = {
  paid: { ar: "مدفوع", color: "bg-[#2D6A4F]" },
  pending: { ar: "قيد الانتظار", color: "bg-[#F4A261]" },
  failed: { ar: "فشل", color: "bg-[#E63946]" },
};

const deliveryModeLabels: Record<Order["deliveryMode"], string> = {
  delivery: "توصيل",
  pickup: "استلام",
};

export function Orders() {
  const [orders] = useState(mockOrders);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [deliveryModeFilter, setDeliveryModeFilter] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const ordersPerPage = 5;

  const filteredOrders = orders.filter((order) => {
    const matchesStatus = statusFilter === "all" || order.status === statusFilter;
    const matchesDeliveryMode =
      deliveryModeFilter === "all" || order.deliveryMode === deliveryModeFilter;
    return matchesStatus && matchesDeliveryMode;
  });

  const totalPages = Math.ceil(filteredOrders.length / ordersPerPage);
  const startIndex = (currentPage - 1) * ordersPerPage;
  const paginatedOrders = filteredOrders.slice(startIndex, startIndex + ordersPerPage);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#212529]" style={{ fontFamily: 'Cairo, sans-serif' }}>
            الطلبات
          </h1>
          <p className="text-sm text-[#6C757D]">إدارة جميع الطلبات</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-lg border border-[#E9ECEF] flex gap-4 items-center">
        <div className="flex-1">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue placeholder="حالة الطلب" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" style={{ fontFamily: 'Cairo, sans-serif' }}>
                جميع الحالات
              </SelectItem>
              <SelectItem value="pending" style={{ fontFamily: 'Cairo, sans-serif' }}>
                قيد الانتظار
              </SelectItem>
              <SelectItem value="confirmed" style={{ fontFamily: 'Cairo, sans-serif' }}>
                مؤكد
              </SelectItem>
              <SelectItem value="preparing" style={{ fontFamily: 'Cairo, sans-serif' }}>
                قيد التحضير
              </SelectItem>
              <SelectItem value="out_for_delivery" style={{ fontFamily: 'Cairo, sans-serif' }}>
                في الطريق
              </SelectItem>
              <SelectItem value="delivered" style={{ fontFamily: 'Cairo, sans-serif' }}>
                تم التوصيل
              </SelectItem>
              <SelectItem value="canceled" style={{ fontFamily: 'Cairo, sans-serif' }}>
                ملغي
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1">
          <Select value={deliveryModeFilter} onValueChange={setDeliveryModeFilter}>
            <SelectTrigger>
              <SelectValue placeholder="طريقة التوصيل" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" style={{ fontFamily: 'Cairo, sans-serif' }}>
                جميع الطرق
              </SelectItem>
              <SelectItem value="delivery" style={{ fontFamily: 'Cairo, sans-serif' }}>
                توصيل
              </SelectItem>
              <SelectItem value="pickup" style={{ fontFamily: 'Cairo, sans-serif' }}>
                استلام
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1">
          <div className="relative">
            <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6C757D]" />
            <Input
              type="date"
              className="pr-10"
              placeholder="التاريخ"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-[#E9ECEF]">
        <Table>
          <TableHeader>
            <TableRow className="bg-[#F8F9FA]">
              <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                رقم الطلب
              </TableHead>
              <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                اسم العميل
              </TableHead>
              <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                الحالة
              </TableHead>
              <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                طريقة التوصيل
              </TableHead>
              <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                تاريخ التوصيل
              </TableHead>
              <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                المبلغ الإجمالي
              </TableHead>
              <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                حالة الدفع
              </TableHead>
              <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                إجراءات
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedOrders.map((order) => (
              <TableRow key={order.id}>
                <TableCell className="font-medium">{order.id}</TableCell>
                <TableCell style={{ fontFamily: 'Cairo, sans-serif' }}>{order.userName}</TableCell>
                <TableCell>
                  <Badge
                    className={`${statusLabels[order.status].color} hover:${
                      statusLabels[order.status].color
                    } text-white`}
                  >
                    {statusLabels[order.status].ar}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" style={{ fontFamily: 'Cairo, sans-serif' }}>
                    {deliveryModeLabels[order.deliveryMode]}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm" dir="ltr">
                  {order.deliveryDate}
                </TableCell>
                <TableCell>
                  <span className="font-medium">{(order.total / 100).toFixed(2)}</span>
                  <span className="text-xs text-[#6C757D] mr-1">ريال</span>
                </TableCell>
                <TableCell>
                  <Badge
                    className={`${paymentStatusLabels[order.paymentStatus].color} hover:${
                      paymentStatusLabels[order.paymentStatus].color
                    } text-white`}
                  >
                    {paymentStatusLabels[order.paymentStatus].ar}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-[#4361EE] hover:text-[#4361EE] hover:bg-[#4361EE]/10"
                  >
                    <Eye className="w-4 h-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex justify-center">
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className={currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
              />
            </PaginationItem>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <PaginationItem key={page}>
                <PaginationLink
                  onClick={() => setCurrentPage(page)}
                  isActive={currentPage === page}
                  className="cursor-pointer"
                >
                  {page}
                </PaginationLink>
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className={
                  currentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"
                }
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    </div>
  );
}
