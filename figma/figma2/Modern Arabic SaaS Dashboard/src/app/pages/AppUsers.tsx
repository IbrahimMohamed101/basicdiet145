import { useState } from "react";
import { Search, Eye, ToggleLeft, ToggleRight } from "lucide-react";
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
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "../components/ui/pagination";
import { Link } from "react-router";

const users = [
  {
    id: "1",
    name: "أحمد محمد",
    phone: "+966501234567",
    email: "ahmed@example.com",
    active: true,
    subscriptionsCount: 3,
    activeSubscriptions: 2,
    createdAt: "2026-01-15",
  },
  {
    id: "2",
    name: "فاطمة علي",
    phone: "+966507654321",
    email: "fatima@example.com",
    active: true,
    subscriptionsCount: 1,
    activeSubscriptions: 1,
    createdAt: "2026-02-20",
  },
  {
    id: "3",
    name: "عمر خالد",
    phone: "+966509876543",
    email: "omar@example.com",
    active: false,
    subscriptionsCount: 5,
    activeSubscriptions: 0,
    createdAt: "2025-12-10",
  },
  {
    id: "4",
    name: "سارة حسن",
    phone: "+966503456789",
    email: "sarah@example.com",
    active: true,
    subscriptionsCount: 2,
    activeSubscriptions: 1,
    createdAt: "2026-02-05",
  },
  {
    id: "5",
    name: "محمد عبدالله",
    phone: "+966508765432",
    email: "mohammed@example.com",
    active: true,
    subscriptionsCount: 4,
    activeSubscriptions: 3,
    createdAt: "2026-01-20",
  },
  {
    id: "6",
    name: "نورة سعيد",
    phone: "+966502345678",
    email: "noura@example.com",
    active: true,
    subscriptionsCount: 1,
    activeSubscriptions: 1,
    createdAt: "2026-03-01",
  },
  {
    id: "7",
    name: "يوسف إبراهيم",
    phone: "+966506789012",
    email: "youssef@example.com",
    active: false,
    subscriptionsCount: 2,
    activeSubscriptions: 0,
    createdAt: "2025-11-15",
  },
  {
    id: "8",
    name: "ليلى أحمد",
    phone: "+966504567890",
    email: "layla@example.com",
    active: true,
    subscriptionsCount: 3,
    activeSubscriptions: 2,
    createdAt: "2026-02-14",
  },
];

export function AppUsers() {
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const filteredUsers = users.filter(
    (user) =>
      user.name.includes(searchQuery) ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.phone.includes(searchQuery)
  );

  const totalPages = Math.ceil(filteredUsers.length / itemsPerPage);
  const paginatedUsers = filteredUsers.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#212529]">مستخدمي التطبيق</h1>
          <p className="text-[#6C757D] mt-1">
            إدارة ومراقبة جميع مستخدمي التطبيق
          </p>
        </div>
      </div>

      {/* Search Bar */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6C757D]" />
          <Input
            placeholder="بحث بالاسم، البريد الإلكتروني أو رقم الهاتف..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pr-10"
          />
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-lg border border-[#E9ECEF]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-right">الاسم</TableHead>
              <TableHead className="text-right ltr">Phone</TableHead>
              <TableHead className="text-right ltr">Email</TableHead>
              <TableHead className="text-right">الحالة</TableHead>
              <TableHead className="text-right">عدد الاشتراكات</TableHead>
              <TableHead className="text-right">الاشتراكات النشطة</TableHead>
              <TableHead className="text-right ltr">Created At</TableHead>
              <TableHead className="text-right">الإجراءات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedUsers.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-medium">{user.name}</TableCell>
                <TableCell className="ltr">{user.phone}</TableCell>
                <TableCell className="ltr">{user.email}</TableCell>
                <TableCell>
                  <Badge variant={user.active ? "default" : "secondary"}>
                    {user.active ? "نشط" : "غير نشط"}
                  </Badge>
                </TableCell>
                <TableCell className="text-center">
                  {user.subscriptionsCount}
                </TableCell>
                <TableCell className="text-center">
                  {user.activeSubscriptions}
                </TableCell>
                <TableCell className="ltr">{user.createdAt}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Link to={`/users/${user.id}`}>
                      <Button size="sm" variant="ghost">
                        <Eye className="w-4 h-4 ml-1" />
                        عرض
                      </Button>
                    </Link>
                    <Button
                      size="sm"
                      variant="ghost"
                      className={user.active ? "text-[#E63946]" : "text-[#2D6A4F]"}
                    >
                      {user.active ? (
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
