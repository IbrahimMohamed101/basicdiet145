import { useState } from "react";
import { Plus, Edit, Trash2, RotateCcw } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { toast } from "sonner";

const staffUsers = [
  {
    id: "1",
    email: "admin@example.com",
    role: "admin",
    active: true,
    lastLogin: "2026-03-10 09:30",
    failedAttempts: 0,
  },
  {
    id: "2",
    email: "kitchen@example.com",
    role: "kitchen",
    active: true,
    lastLogin: "2026-03-10 08:15",
    failedAttempts: 0,
  },
  {
    id: "3",
    email: "courier1@example.com",
    role: "courier",
    active: true,
    lastLogin: "2026-03-09 18:45",
    failedAttempts: 0,
  },
  {
    id: "4",
    email: "courier2@example.com",
    role: "courier",
    active: false,
    lastLogin: "2026-03-05 12:20",
    failedAttempts: 3,
  },
];

const getRoleBadge = (role: string) => {
  const roleConfig: Record<string, { label: string; className: string }> = {
    admin: { label: "مسؤول", className: "bg-[#1B4332] text-white" },
    kitchen: { label: "مطبخ", className: "bg-[#F4A261] text-white" },
    courier: { label: "موصل", className: "bg-[#4361EE] text-white" },
  };

  const config = roleConfig[role] || { label: role, className: "" };
  return <Badge className={config.className}>{config.label}</Badge>;
};

export function StaffUsers() {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newStaff, setNewStaff] = useState({ email: "", role: "courier" });

  const handleAddStaff = () => {
    toast.success("تم إضافة موظف جديد بنجاح");
    setIsAddDialogOpen(false);
    setNewStaff({ email: "", role: "courier" });
  };

  const handleDelete = (email: string) => {
    toast.success(`تم حذف ${email} بنجاح`);
  };

  const handleResetPassword = (email: string) => {
    toast.success(`تم إرسال رابط إعادة تعيين كلمة المرور إلى ${email}`);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#212529]">إدارة الموظفين</h1>
          <p className="text-[#6C757D] mt-1">
            إدارة موظفي لوحة التحكم والصلاحيات
          </p>
        </div>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-[#1B4332] hover:bg-[#2D6A4F]">
              <Plus className="ml-2 w-4 h-4" />
              إضافة موظف
            </Button>
          </DialogTrigger>
          <DialogContent className="rtl">
            <DialogHeader>
              <DialogTitle>إضافة موظف جديد</DialogTitle>
              <DialogDescription>
                أدخل معلومات الموظف الجديد وحدد الصلاحيات
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="ltr">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="email@example.com"
                  value={newStaff.email}
                  onChange={(e) =>
                    setNewStaff({ ...newStaff, email: e.target.value })
                  }
                  className="ltr"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">الدور</Label>
                <Select
                  value={newStaff.role}
                  onValueChange={(value) =>
                    setNewStaff({ ...newStaff, role: value })
                  }
                >
                  <SelectTrigger id="role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rtl">
                    <SelectItem value="admin">مسؤول (Admin)</SelectItem>
                    <SelectItem value="kitchen">مطبخ (Kitchen)</SelectItem>
                    <SelectItem value="courier">موصل (Courier)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsAddDialogOpen(false)}
              >
                إلغاء
              </Button>
              <Button
                onClick={handleAddStaff}
                className="bg-[#1B4332] hover:bg-[#2D6A4F]"
              >
                حفظ
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Staff Table */}
      <div className="bg-white rounded-lg border border-[#E9ECEF]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-right ltr">Email</TableHead>
              <TableHead className="text-right">الدور</TableHead>
              <TableHead className="text-right">الحالة</TableHead>
              <TableHead className="text-right ltr">Last Login</TableHead>
              <TableHead className="text-right">محاولات فاشلة</TableHead>
              <TableHead className="text-right">الإجراءات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {staffUsers.map((staff) => (
              <TableRow key={staff.id}>
                <TableCell className="font-medium ltr">{staff.email}</TableCell>
                <TableCell>{getRoleBadge(staff.role)}</TableCell>
                <TableCell>
                  <Badge variant={staff.active ? "default" : "secondary"}>
                    {staff.active ? "نشط" : "غير نشط"}
                  </Badge>
                </TableCell>
                <TableCell className="ltr">{staff.lastLogin}</TableCell>
                <TableCell className="text-center">
                  {staff.failedAttempts > 0 ? (
                    <span className="text-[#E63946] font-medium">
                      {staff.failedAttempts}
                    </span>
                  ) : (
                    <span className="text-[#2D6A4F]">0</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="ghost">
                      <Edit className="w-4 h-4 ml-1" />
                      تعديل
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleResetPassword(staff.email)}
                    >
                      <RotateCcw className="w-4 h-4 ml-1" />
                      إعادة تعيين
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
                          <AlertDialogTitle>هل أنت متأكد؟</AlertDialogTitle>
                          <AlertDialogDescription>
                            سيتم حذف الموظف {staff.email} بشكل نهائي. لا يمكن
                            التراجع عن هذا الإجراء.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>إلغاء</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDelete(staff.email)}
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
    </div>
  );
}
