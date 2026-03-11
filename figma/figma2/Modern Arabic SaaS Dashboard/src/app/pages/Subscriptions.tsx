import { useState } from "react";
import { Search, Eye, X, Calendar } from "lucide-react";
import { Input } from "../components/ui/input";
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
import { Link } from "react-router";
import { toast } from "sonner";

const subscriptions = [
  {
    id: "SUB-001",
    userName: "أحمد محمد",
    plan: "Premium Monthly",
    status: "active",
    startDate: "2026-03-01",
    endDate: "2026-04-01",
    remainingMeals: 18,
    deliveryMode: "pickup",
  },
  {
    id: "SUB-002",
    userName: "فاطمة علي",
    plan: "Standard Weekly",
    status: "pending",
    startDate: "2026-03-10",
    endDate: "2026-03-17",
    remainingMeals: 14,
    deliveryMode: "delivery",
  },
  {
    id: "SUB-003",
    userName: "عمر خالد",
    plan: "Premium Weekly",
    status: "active",
    startDate: "2026-03-08",
    endDate: "2026-03-15",
    remainingMeals: 9,
    deliveryMode: "delivery",
  },
  {
    id: "SUB-004",
    userName: "سارة حسن",
    plan: "Standard Monthly",
    status: "active",
    startDate: "2026-03-05",
    endDate: "2026-04-05",
    remainingMeals: 22,
    deliveryMode: "pickup",
  },
  {
    id: "SUB-005",
    userName: "محمد عبدالله",
    plan: "Premium Monthly",
    status: "canceled",
    startDate: "2026-02-01",
    endDate: "2026-03-01",
    remainingMeals: 0,
    deliveryMode: "delivery",
  },
  {
    id: "SUB-006",
    userName: "نورة سعيد",
    plan: "Standard Weekly",
    status: "active",
    startDate: "2026-03-09",
    endDate: "2026-03-16",
    remainingMeals: 11,
    deliveryMode: "pickup",
  },
];

const getStatusBadge = (status: string) => {
  const statusConfig: Record<
    string,
    { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
  > = {
    active: { label: "نشط", variant: "default" },
    pending: { label: "معلق", variant: "secondary" },
    canceled: { label: "ملغي", variant: "destructive" },
  };

  const config = statusConfig[status] || { label: status, variant: "outline" as const };
  return <Badge variant={config.variant}>{config.label}</Badge>;
};

const getDeliveryModeBadge = (mode: string) => {
  const modeConfig: Record<string, { label: string; className: string }> = {
    delivery: { label: "توصيل", className: "bg-[#4361EE] text-white" },
    pickup: { label: "استلام", className: "bg-[#40916C] text-white" },
  };

  const config = modeConfig[mode] || { label: mode, className: "" };
  return <Badge className={config.className}>{config.label}</Badge>;
};

export function Subscriptions() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const filteredSubscriptions = subscriptions.filter((sub) => {
    const matchesSearch =
      sub.userName.includes(searchQuery) ||
      sub.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      sub.plan.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === "all" || sub.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const totalPages = Math.ceil(filteredSubscriptions.length / itemsPerPage);
  const paginatedSubscriptions = filteredSubscriptions.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const handleCancel = (id: string) => {
    toast.success(`تم إلغاء الاشتراك ${id} بنجاح`);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[#212529]">الاشتراكات</h1>
        <p className="text-[#6C757D] mt-1">إدارة ومراقبة جميع الاشتراكات</p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 bg-white p-4 rounded-lg border border-[#E9ECEF]">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6C757D]" />
          <Input
            placeholder="بحث بالاسم، رقم الاشتراك أو الباقة..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pr-10"
          />
        </div>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="تصفية حسب الحالة" />
          </SelectTrigger>
          <SelectContent className="rtl">
            <SelectItem value="all">جميع الحالات</SelectItem>
            <SelectItem value="active">نشط</SelectItem>
            <SelectItem value="pending">معلق</SelectItem>
            <SelectItem value="canceled">ملغي</SelectItem>
          </SelectContent>
        </Select>

        <Button variant="outline">
          <Calendar className="ml-2 w-4 h-4" />
          نطاق التاريخ
        </Button>
      </div>

      {/* Subscriptions Table */}
      <div className="bg-white rounded-lg border border-[#E9ECEF]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-right ltr">ID</TableHead>
              <TableHead className="text-right">اسم المستخدم</TableHead>
              <TableHead className="text-right ltr">Plan</TableHead>
              <TableHead className="text-right">الحالة</TableHead>
              <TableHead className="text-right ltr">Start Date</TableHead>
              <TableHead className="text-right ltr">End Date</TableHead>
              <TableHead className="text-right">الوجبات المتبقية</TableHead>
              <TableHead className="text-right">طريقة التوصيل</TableHead>
              <TableHead className="text-right">الإجراءات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedSubscriptions.map((sub) => (
              <TableRow key={sub.id}>
                <TableCell className="font-medium ltr">{sub.id}</TableCell>
                <TableCell>{sub.userName}</TableCell>
                <TableCell className="ltr">{sub.plan}</TableCell>
                <TableCell>{getStatusBadge(sub.status)}</TableCell>
                <TableCell className="ltr">{sub.startDate}</TableCell>
                <TableCell className="ltr">{sub.endDate}</TableCell>
                <TableCell className="text-center">{sub.remainingMeals}</TableCell>
                <TableCell>{getDeliveryModeBadge(sub.deliveryMode)}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Link to={`/subscriptions/${sub.id}`}>
                      <Button size="sm" variant="ghost">
                        <Eye className="w-4 h-4 ml-1" />
                        عرض
                      </Button>
                    </Link>
                    {(sub.status === "active" || sub.status === "pending") && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-[#E63946] hover:text-[#E63946] hover:bg-[#E63946]/10"
                          >
                            <X className="w-4 h-4 ml-1" />
                            إلغاء
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="rtl">
                          <AlertDialogHeader>
                            <AlertDialogTitle>إلغاء الاشتراك</AlertDialogTitle>
                            <AlertDialogDescription>
                              هل أنت متأكد من إلغاء الاشتراك {sub.id} للمستخدم{" "}
                              {sub.userName}؟ هذا الإجراء لا يمكن التراجع عنه.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>تراجع</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleCancel(sub.id)}
                              className="bg-[#E63946] hover:bg-[#D62839]"
                            >
                              إلغاء الاشتراك
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className={currentPage === 1 ? "pointer-events-none opacity-50" : ""}
              />
            </PaginationItem>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <PaginationItem key={page}>
                <PaginationLink
                  onClick={() => setCurrentPage(page)}
                  isActive={currentPage === page}
                >
                  {page}
                </PaginationLink>
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className={
                  currentPage === totalPages ? "pointer-events-none opacity-50" : ""
                }
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}
