import { useState } from "react";
import { Plus, Edit, Trash2, ToggleLeft, ToggleRight } from "lucide-react";
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
import { Switch } from "../components/ui/switch";
import { toast } from "sonner";

type Meal = {
  id: string;
  nameAr: string;
  nameEn: string;
  active: boolean;
};

const initialMeals: Meal[] = [
  {
    id: "1",
    nameAr: "دجاج مشوي",
    nameEn: "Grilled Chicken",
    active: true,
  },
  {
    id: "2",
    nameAr: "سلمون مشوي",
    nameEn: "Grilled Salmon",
    active: true,
  },
  {
    id: "3",
    nameAr: "لحم بقري",
    nameEn: "Beef",
    active: true,
  },
  {
    id: "4",
    nameAr: "دجاج تيرياكي",
    nameEn: "Chicken Teriyaki",
    active: true,
  },
  {
    id: "5",
    nameAr: "سمك أبيض",
    nameEn: "White Fish",
    active: false,
  },
  {
    id: "6",
    nameAr: "ستيك لحم",
    nameEn: "Beef Steak",
    active: true,
  },
  {
    id: "7",
    nameAr: "دجاج بالكاري",
    nameEn: "Chicken Curry",
    active: true,
  },
  {
    id: "8",
    nameAr: "جمبري مشوي",
    nameEn: "Grilled Shrimp",
    active: true,
  },
];

export function RegularMeals() {
  const [meals, setMeals] = useState<Meal[]>(initialMeals);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingMeal, setEditingMeal] = useState<Meal | null>(null);
  const [formData, setFormData] = useState({
    nameAr: "",
    nameEn: "",
    active: true,
  });

  const openAddDialog = () => {
    setEditingMeal(null);
    setFormData({ nameAr: "", nameEn: "", active: true });
    setIsDialogOpen(true);
  };

  const openEditDialog = (meal: Meal) => {
    setEditingMeal(meal);
    setFormData({
      nameAr: meal.nameAr,
      nameEn: meal.nameEn,
      active: meal.active,
    });
    setIsDialogOpen(true);
  };

  const handleSave = () => {
    if (editingMeal) {
      setMeals(
        meals.map((m) =>
          m.id === editingMeal.id ? { ...m, ...formData } : m
        )
      );
      toast.success(`تم تحديث الوجبة ${formData.nameAr} بنجاح`);
    } else {
      const newMeal: Meal = {
        id: String(meals.length + 1),
        ...formData,
      };
      setMeals([...meals, newMeal]);
      toast.success(`تم إضافة الوجبة ${formData.nameAr} بنجاح`);
    }
    setIsDialogOpen(false);
  };

  const handleDelete = (meal: Meal) => {
    setMeals(meals.filter((m) => m.id !== meal.id));
    toast.success(`تم حذف الوجبة ${meal.nameAr} بنجاح`);
  };

  const handleToggle = (meal: Meal) => {
    setMeals(
      meals.map((m) =>
        m.id === meal.id ? { ...m, active: !m.active } : m
      )
    );
    toast.success(
      `تم ${meal.active ? "تعطيل" : "تفعيل"} الوجبة ${meal.nameAr} بنجاح`
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#212529]">الوجبات العادية</h1>
          <p className="text-[#6C757D] mt-1">إدارة قائمة الوجبات العادية المتاحة</p>
        </div>
        <Button
          onClick={openAddDialog}
          className="bg-[#1B4332] hover:bg-[#2D6A4F]"
        >
          <Plus className="ml-2 w-4 h-4" />
          إضافة وجبة
        </Button>
      </div>

      {/* Meals Table */}
      <div className="bg-white rounded-lg border border-[#E9ECEF]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-right">الاسم بالعربي</TableHead>
              <TableHead className="text-right ltr">Name (EN)</TableHead>
              <TableHead className="text-right">الحالة</TableHead>
              <TableHead className="text-right">الإجراءات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {meals.map((meal) => (
              <TableRow key={meal.id}>
                <TableCell className="font-medium">{meal.nameAr}</TableCell>
                <TableCell className="ltr">{meal.nameEn}</TableCell>
                <TableCell>
                  <Badge variant={meal.active ? "default" : "secondary"}>
                    {meal.active ? "نشط" : "غير نشط"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openEditDialog(meal)}
                    >
                      <Edit className="w-4 h-4 ml-1" />
                      تعديل
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleToggle(meal)}
                    >
                      {meal.active ? (
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
                          <AlertDialogTitle>حذف الوجبة</AlertDialogTitle>
                          <AlertDialogDescription>
                            هل أنت متأكد من حذف الوجبة {meal.nameAr}؟ هذا الإجراء لا
                            يمكن التراجع عنه.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>إلغاء</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDelete(meal)}
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

      {/* Add/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="rtl">
          <DialogHeader>
            <DialogTitle>
              {editingMeal ? "تعديل الوجبة" : "إضافة وجبة جديدة"}
            </DialogTitle>
            <DialogDescription>
              {editingMeal
                ? "قم بتحديث معلومات الوجبة"
                : "أدخل معلومات الوجبة الجديدة"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="nameAr">الاسم بالعربي</Label>
              <Input
                id="nameAr"
                value={formData.nameAr}
                onChange={(e) =>
                  setFormData({ ...formData, nameAr: e.target.value })
                }
                placeholder="مثال: دجاج مشوي"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nameEn" className="ltr">Name (EN)</Label>
              <Input
                id="nameEn"
                value={formData.nameEn}
                onChange={(e) =>
                  setFormData({ ...formData, nameEn: e.target.value })
                }
                placeholder="Example: Grilled Chicken"
                className="ltr"
              />
            </div>
            <div className="flex items-center justify-between pt-4">
              <div>
                <Label className="ltr">Is Active</Label>
                <p className="text-sm text-[#6C757D] mt-1">
                  تفعيل أو تعطيل الوجبة
                </p>
              </div>
              <Switch
                checked={formData.active}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, active: checked })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              إلغاء
            </Button>
            <Button
              onClick={handleSave}
              className="bg-[#1B4332] hover:bg-[#2D6A4F]"
            >
              {editingMeal ? "حفظ التغييرات" : "إضافة"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
