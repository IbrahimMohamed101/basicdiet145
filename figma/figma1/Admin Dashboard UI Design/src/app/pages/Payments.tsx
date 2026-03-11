import { useState } from "react";
import { Eye, CheckCircle, Calendar } from "lucide-react";
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

interface Payment {
  id: string;
  userName: string;
  type: "subscription" | "one_time" | "addon";
  status: "paid" | "pending" | "failed" | "refunded";
  amount: number;
  provider: "mada" | "visa" | "mastercard" | "apple_pay" | "stc_pay";
  paidAt: string;
}

const mockPayments: Payment[] = [
  {
    id: "PAY-2024-0001",
    userName: "محمد أحمد",
    type: "subscription",
    status: "paid",
    amount: 15000,
    provider: "mada",
    paidAt: "2024-03-10 14:30",
  },
  {
    id: "PAY-2024-0002",
    userName: "فاطمة علي",
    type: "one_time",
    status: "paid",
    amount: 12500,
    provider: "visa",
    paidAt: "2024-03-10 15:45",
  },
  {
    id: "PAY-2024-0003",
    userName: "خالد محمود",
    type: "addon",
    status: "pending",
    amount: 2500,
    provider: "apple_pay",
    paidAt: "2024-03-11 09:15",
  },
  {
    id: "PAY-2024-0004",
    userName: "سارة حسن",
    type: "subscription",
    status: "failed",
    amount: 14000,
    provider: "mastercard",
    paidAt: "2024-03-11 10:20",
  },
  {
    id: "PAY-2024-0005",
    userName: "عبدالله عمر",
    type: "one_time",
    status: "paid",
    amount: 16500,
    provider: "stc_pay",
    paidAt: "2024-03-11 11:30",
  },
  {
    id: "PAY-2024-0006",
    userName: "نورة سالم",
    type: "subscription",
    status: "refunded",
    amount: 11000,
    provider: "mada",
    paidAt: "2024-03-09 08:45",
  },
];

const typeLabels: Record<Payment["type"], { ar: string; color: string }> = {
  subscription: { ar: "اشتراك", color: "bg-[#4361EE]" },
  one_time: { ar: "مرة واحدة", color: "bg-[#F4A261]" },
  addon: { ar: "إضافة", color: "bg-[#40916C]" },
};

const statusLabels: Record<Payment["status"], { ar: string; color: string }> = {
  paid: { ar: "مدفوع", color: "bg-[#2D6A4F]" },
  pending: { ar: "قيد الانتظار", color: "bg-[#F4A261]" },
  failed: { ar: "فشل", color: "bg-[#E63946]" },
  refunded: { ar: "مسترد", color: "bg-[#6C757D]" },
};

const providerLabels: Record<Payment["provider"], string> = {
  mada: "مدى",
  visa: "فيزا",
  mastercard: "ماستركارد",
  apple_pay: "Apple Pay",
  stc_pay: "STC Pay",
};

export function Payments() {
  const [payments] = useState(mockPayments);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const paymentsPerPage = 5;

  const filteredPayments = payments.filter((payment) => {
    const matchesStatus = statusFilter === "all" || payment.status === statusFilter;
    const matchesType = typeFilter === "all" || payment.type === typeFilter;
    return matchesStatus && matchesType;
  });

  const totalPages = Math.ceil(filteredPayments.length / paymentsPerPage);
  const startIndex = (currentPage - 1) * paymentsPerPage;
  const paginatedPayments = filteredPayments.slice(startIndex, startIndex + paymentsPerPage);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#212529]" style={{ fontFamily: 'Cairo, sans-serif' }}>
            المدفوعات
          </h1>
          <p className="text-sm text-[#6C757D]">إدارة جميع المدفوعات والمعاملات المالية</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-lg border border-[#E9ECEF] flex gap-4 items-center">
        <div className="flex-1">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue placeholder="حالة الدفع" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" style={{ fontFamily: 'Cairo, sans-serif' }}>
                جميع الحالات
              </SelectItem>
              <SelectItem value="paid" style={{ fontFamily: 'Cairo, sans-serif' }}>
                مدفوع
              </SelectItem>
              <SelectItem value="pending" style={{ fontFamily: 'Cairo, sans-serif' }}>
                قيد الانتظار
              </SelectItem>
              <SelectItem value="failed" style={{ fontFamily: 'Cairo, sans-serif' }}>
                فشل
              </SelectItem>
              <SelectItem value="refunded" style={{ fontFamily: 'Cairo, sans-serif' }}>
                مسترد
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger>
              <SelectValue placeholder="نوع الدفع" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" style={{ fontFamily: 'Cairo, sans-serif' }}>
                جميع الأنواع
              </SelectItem>
              <SelectItem value="subscription" style={{ fontFamily: 'Cairo, sans-serif' }}>
                اشتراك
              </SelectItem>
              <SelectItem value="one_time" style={{ fontFamily: 'Cairo, sans-serif' }}>
                مرة واحدة
              </SelectItem>
              <SelectItem value="addon" style={{ fontFamily: 'Cairo, sans-serif' }}>
                إضافة
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
                رقم الدفع
              </TableHead>
              <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                اسم العميل
              </TableHead>
              <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                النوع
              </TableHead>
              <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                الحالة
              </TableHead>
              <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                المبلغ
              </TableHead>
              <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                مزود الدفع
              </TableHead>
              <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                تاريخ الدفع
              </TableHead>
              <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                إجراءات
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedPayments.map((payment) => (
              <TableRow key={payment.id}>
                <TableCell className="font-medium">{payment.id}</TableCell>
                <TableCell style={{ fontFamily: 'Cairo, sans-serif' }}>{payment.userName}</TableCell>
                <TableCell>
                  <Badge
                    className={`${typeLabels[payment.type].color} hover:${
                      typeLabels[payment.type].color
                    } text-white`}
                  >
                    {typeLabels[payment.type].ar}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge
                    className={`${statusLabels[payment.status].color} hover:${
                      statusLabels[payment.status].color
                    } text-white`}
                  >
                    {statusLabels[payment.status].ar}
                  </Badge>
                </TableCell>
                <TableCell>
                  <span className="font-medium">{(payment.amount / 100).toFixed(2)}</span>
                  <span className="text-xs text-[#6C757D] mr-1">ريال</span>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" style={{ fontFamily: 'Cairo, sans-serif' }}>
                    {providerLabels[payment.provider]}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm" dir="ltr">
                  {payment.paidAt}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-[#4361EE] hover:text-[#4361EE] hover:bg-[#4361EE]/10"
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                    {payment.status === "pending" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-3 text-[#2D6A4F] hover:text-[#2D6A4F] hover:bg-[#2D6A4F]/10"
                      >
                        <CheckCircle className="w-4 h-4 ml-1" />
                        تحقق
                      </Button>
                    )}
                  </div>
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
