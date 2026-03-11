import { useState } from "react";
import { Plus, Edit, Copy, Trash2, GripVertical, ToggleLeft, ToggleRight } from "lucide-react";
import { Link } from "react-router";
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
import { toast } from "sonner";

const plans = [
  {
    id: "1",
    nameAr: "باقة شهرية مميزة",
    nameEn: "Premium Monthly",
    daysCount: 30,
    active: true,
    sortOrder: 1,
    gramsOptionsCount: 3,
  },
  {
    id: "2",
    nameAr: "باقة أسبوعية عادية",
    nameEn: "Standard Weekly",
    daysCount: 7,
    active: true,
    sortOrder: 2,
    gramsOptionsCount: 2,
  },
  {
    id: "3",
    nameAr: "باقة أسبوعية مميزة",
    nameEn: "Premium Weekly",
    daysCount: 7,
    active: true,
    sortOrder: 3,
    gramsOptionsCount: 4,
  },
  {
    id: "4",
    nameAr: "باقة نصف شهرية",
    nameEn: "Bi-Weekly Plan",
    daysCount: 14,
    active: false,
    sortOrder: 4,
    gramsOptionsCount: 2,
  },
  {
    id: "5",
    nameAr: "باقة ثلاثة أشهر",
    nameEn: "Quarterly Plan",
    daysCount: 90,
    active: true,
    sortOrder: 5,
    gramsOptionsCount: 5,
  },
];

export function Plans() {
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const totalPages = Math.ceil(plans.length / itemsPerPage);
  const paginatedPlans = plans.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const handleDelete = (nameAr: string) => {
    toast.success(`تم حذف الباقة ${nameAr} بنجاح`);
  };

  const handleClone = (nameAr: string) => {
    toast.success(`تم نسخ الباقة ${nameAr} بنجاح`);
  };

  const handleToggle = (nameAr: string, active: boolean) => {
    toast.success(`تم ${active ? "تعطيل" : "تفعيل"} الباقة ${nameAr} بنجاح`);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#212529]">الباقات</h1>
          <p className="text-[#6C757D] mt-1">إدارة باقات الاشتراكات وخيارات الأسعار</p>
        </div>
        <Link to="/plans/new">
          <Button className="bg-[#1B4332] hover:bg-[#2D6A4F]">
            <Plus className="ml-2 w-4 h-4" />
            إنشاء باقة
          </Button>
        </Link>
      </div>

      {/* Plans Table */}
      <div className="bg-white rounded-lg border border-[#E9ECEF]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12"></TableHead>
              <TableHead className="text-right">الاسم بالعربي</TableHead>
              <TableHead className="text-right ltr">Name (EN)</TableHead>
              <TableHead className="text-right ltr">Days Count</TableHead>
              <TableHead className="text-right">الحالة</TableHead>
              <TableHead className="text-right ltr">Sort Order</TableHead>
              <TableHead className="text-right">خيارات الجرام</TableHead>
              <TableHead className="text-right">الإجراءات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedPlans.map((plan) => (
              <TableRow key={plan.id}>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="cursor-move hover:bg-[#E9ECEF]"
                  >
                    <GripVertical className="w-4 h-4 text-[#6C757D]" />
                  </Button>
                </TableCell>
                <TableCell className="font-medium">{plan.nameAr}</TableCell>
                <TableCell className="ltr">{plan.nameEn}</TableCell>
                <TableCell className="text-center ltr">{plan.daysCount}</TableCell>
                <TableCell>
                  <Badge variant={plan.active ? "default" : "secondary"}>
                    {plan.active ? "نشط" : "غير نشط"}
                  </Badge>
                </TableCell>
                <TableCell className="text-center ltr">{plan.sortOrder}</TableCell>
                <TableCell className="text-center">{plan.gramsOptionsCount}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Link to={`/plans/${plan.id}`}>
                      <Button size="sm" variant="ghost">
                        <Edit className="w-4 h-4 ml-1" />
                        تعديل
                      </Button>
                    </Link>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleToggle(plan.nameAr, plan.active)}
                    >
                      {plan.active ? (
                        <>
                          <ToggleRight className="w-4 h-4 ml-1" />
                          تعطيل
                        </>
                      ) : (
                        <>
                          <ToggleLeft className="w-4 h-4 ml-1" />
                          تفعيل
                        </>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleClone(plan.nameAr)}
                    >
                      <Copy className="w-4 h-4 ml-1" />
                      نسخ
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-[#E63946] hover:text-[#E63946] hover:bg-[#E63946]/10"
                        >
                          <Trash2 className="w-4 h-4 ml-1" />
                          حذف
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="rtl">
                        <AlertDialogHeader>
                          <AlertDialogTitle>حذف الباقة</AlertDialogTitle>
                          <AlertDialogDescription>
                            هل أنت متأكد من حذف الباقة {plan.nameAr}? هذا الإجراء لا يمكن
                            التراجع عنه.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>إلغاء</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDelete(plan.nameAr)}
                            className="bg-[#E63946] hover:bg-[#D62839]"
                          >
                            حذف
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
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
