import { useState } from "react";
import {
  Plus,
  Edit,
  Trash2,
  Copy,
  GripVertical,
  ToggleLeft,
  ToggleRight,
  Image as ImageIcon,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardFooter } from "../components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { Textarea } from "../components/ui/textarea";
import { Switch } from "../components/ui/switch";
import { toast } from "sonner";

type PremiumMeal = {
  id: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  descriptionEn: string;
  imageUrl: string;
  extraFeeHalala: number;
  sortOrder: number;
  active: boolean;
};

const initialMeals: PremiumMeal[] = [
  {
    id: "1",
    nameAr: "ستيك لحم أنجوس",
    nameEn: "Angus Beef Steak",
    descriptionAr: "ستيك لحم بقري أنجوس فاخر مشوي على الفحم",
    descriptionEn: "Premium Angus beef steak grilled over charcoal",
    imageUrl: "https://images.unsplash.com/photo-1546833998-877b37c2e5c6?w=400",
    extraFeeHalala: 3500,
    sortOrder: 1,
    active: true,
  },
  {
    id: "2",
    nameAr: "سلمون نرويجي",
    nameEn: "Norwegian Salmon",
    descriptionAr: "سلمون نرويجي طازج مع صوص الليمون والأعشاب",
    descriptionEn: "Fresh Norwegian salmon with lemon herb sauce",
    imageUrl: "https://images.unsplash.com/photo-1485704686097-ed47f7263ca4?w=400",
    extraFeeHalala: 4000,
    sortOrder: 2,
    active: true,
  },
  {
    id: "3",
    nameAr: "جمبري ملكي",
    nameEn: "King Prawns",
    descriptionAr: "جمبري ملكي مشوي مع الثوم والبقدونس",
    descriptionEn: "Grilled king prawns with garlic and parsley",
    imageUrl: "https://images.unsplash.com/photo-1565680018434-b513d5e5fd47?w=400",
    extraFeeHalala: 4500,
    sortOrder: 3,
    active: true,
  },
  {
    id: "4",
    nameAr: "لحم غنم مشوي",
    nameEn: "Grilled Lamb",
    descriptionAr: "قطع لحم غنم طرية مشوية مع التوابل الخاصة",
    descriptionEn: "Tender grilled lamb pieces with special spices",
    imageUrl: "https://images.unsplash.com/photo-1529692236671-f1f6cf9683ba?w=400",
    extraFeeHalala: 3800,
    sortOrder: 4,
    active: true,
  },
  {
    id: "5",
    nameAr: "تونة طازجة",
    nameEn: "Fresh Tuna",
    descriptionAr: "شرائح تونة طازجة مشوية بخفة",
    descriptionEn: "Lightly grilled fresh tuna steaks",
    imageUrl: "https://images.unsplash.com/photo-1580959707703-26c0eb2e6ab0?w=400",
    extraFeeHalala: 4200,
    sortOrder: 5,
    active: false,
  },
  {
    id: "6",
    nameAr: "صدر بط مقلي",
    nameEn: "Pan-Seared Duck Breast",
    descriptionAr: "صدر بط مقلي مع صوص التوت البري",
    descriptionEn: "Pan-seared duck breast with cranberry sauce",
    imageUrl: "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=400",
    extraFeeHalala: 5000,
    sortOrder: 6,
    active: true,
  },
];

export function PremiumMeals() {
  const [meals, setMeals] = useState<PremiumMeal[]>(initialMeals);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingMeal, setEditingMeal] = useState<PremiumMeal | null>(null);
  const [formData, setFormData] = useState({
    nameAr: "",
    nameEn: "",
    descriptionAr: "",
    descriptionEn: "",
    imageUrl: "",
    extraFeeHalala: 0,
    sortOrder: 0,
    active: true,
  });

  const openAddDialog = () => {
    setEditingMeal(null);
    setFormData({
      nameAr: "",
      nameEn: "",
      descriptionAr: "",
      descriptionEn: "",
      imageUrl: "",
      extraFeeHalala: 0,
      sortOrder: meals.length + 1,
      active: true,
    });
    setIsDialogOpen(true);
  };

  const openEditDialog = (meal: PremiumMeal) => {
    setEditingMeal(meal);
    setFormData({
      nameAr: meal.nameAr,
      nameEn: meal.nameEn,
      descriptionAr: meal.descriptionAr,
      descriptionEn: meal.descriptionEn,
      imageUrl: meal.imageUrl,
      extraFeeHalala: meal.extraFeeHalala,
      sortOrder: meal.sortOrder,
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
      const newMeal: PremiumMeal = {
        id: String(meals.length + 1),
        ...formData,
      };
      setMeals([...meals, newMeal]);
      toast.success(`تم إضافة الوجبة ${formData.nameAr} بنجاح`);
    }
    setIsDialogOpen(false);
  };

  const handleDelete = (meal: PremiumMeal) => {
    setMeals(meals.filter((m) => m.id !== meal.id));
    toast.success(`تم حذف الوجبة ${meal.nameAr} بنجاح`);
  };

  const handleClone = (meal: PremiumMeal) => {
    const newMeal: PremiumMeal = {
      ...meal,
      id: String(meals.length + 1),
      nameAr: `${meal.nameAr} (نسخة)`,
      nameEn: `${meal.nameEn} (Copy)`,
      sortOrder: meals.length + 1,
    };
    setMeals([...meals, newMeal]);
    toast.success(`تم نسخ الوجبة ${meal.nameAr} بنجاح`);
  };

  const handleToggle = (meal: PremiumMeal) => {
    setMeals(
      meals.map((m) =>
        m.id === meal.id ? { ...m, active: !m.active } : m
      )
    );
    toast.success(
      `تم ${meal.active ? "تعطيل" : "تفعيل"} الوجبة ${meal.nameAr} بنجاح`
    );
  };

  const formatPrice = (halala: number) => {
    const sar = halala / 100;
    return `${sar.toFixed(2)} ريال`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#212529]">الوجبات المميزة</h1>
          <p className="text-[#6C757D] mt-1">
            إدارة قائمة الوجبات المميزة والأسعار الإضافية
          </p>
        </div>
        <Button
          onClick={openAddDialog}
          className="bg-[#1B4332] hover:bg-[#2D6A4F]"
        >
          <Plus className="ml-2 w-4 h-4" />
          إضافة وجبة مميزة
        </Button>
      </div>

      {/* Meals Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {meals.map((meal) => (
          <Card key={meal.id} className="overflow-hidden">
            <div className="relative h-48 bg-[#E9ECEF] flex items-center justify-center">
              {meal.imageUrl ? (
                <img
                  src={meal.imageUrl}
                  alt={meal.nameAr}
                  className="w-full h-full object-cover"
                />
              ) : (
                <ImageIcon className="w-16 h-16 text-[#6C757D]" />
              )}
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2 bg-white/90 hover:bg-white cursor-move"
              >
                <GripVertical className="w-4 h-4" />
              </Button>
            </div>
            <CardContent className="p-4 space-y-3">
              <div>
                <h3 className="font-bold text-lg text-[#212529]">{meal.nameAr}</h3>
                <p className="text-sm text-[#6C757D] ltr">{meal.nameEn}</p>
              </div>
              <p className="text-sm text-[#6C757D] line-clamp-2">
                {meal.descriptionAr}
              </p>
              <div className="flex items-center justify-between">
                <Badge className="bg-[#F4A261] text-white">
                  {formatPrice(meal.extraFeeHalala)} +
                </Badge>
                <Badge variant={meal.active ? "default" : "secondary"}>
                  {meal.active ? "نشط" : "غير نشط"}
                </Badge>
              </div>
              <div className="text-xs text-[#6C757D]">
                <span className="ltr">Sort Order: {meal.sortOrder}</span>
              </div>
            </CardContent>
            <CardFooter className="p-4 pt-0 flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={() => openEditDialog(meal)}
              >
                <Edit className="w-3 h-3 ml-1" />
                تعديل
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleToggle(meal)}
              >
                {meal.active ? (
                  <ToggleRight className="w-4 h-4" />
                ) : (
                  <ToggleLeft className="w-4 h-4" />
                )}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleClone(meal)}
              >
                <Copy className="w-4 h-4" />
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-[#E63946] hover:text-[#E63946] border-[#E63946]"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="rtl">
                  <AlertDialogHeader>
                    <AlertDialogTitle>حذف الوجبة المميزة</AlertDialogTitle>
                    <AlertDialogDescription>
                      هل أنت متأكد من حذف الوجبة {meal.nameAr}؟ هذا الإجراء لا يمكن
                      التراجع عنه.
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
            </CardFooter>
          </Card>
        ))}
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="rtl max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingMeal ? "تعديل الوجبة المميزة" : "إضافة وجبة مميزة جديدة"}
            </DialogTitle>
            <DialogDescription>
              {editingMeal
                ? "قم بتحديث معلومات الوجبة المميزة"
                : "أدخل معلومات الوجبة المميزة الجديدة"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="nameAr">الاسم بالعربي</Label>
                <Input
                  id="nameAr"
                  value={formData.nameAr}
                  onChange={(e) =>
                    setFormData({ ...formData, nameAr: e.target.value })
                  }
                  placeholder="مثال: ستيك لحم أنجوس"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nameEn" className="ltr">
                  Name (EN)
                </Label>
                <Input
                  id="nameEn"
                  value={formData.nameEn}
                  onChange={(e) =>
                    setFormData({ ...formData, nameEn: e.target.value })
                  }
                  placeholder="Example: Angus Beef Steak"
                  className="ltr"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="descriptionAr">الوصف بالعربي</Label>
              <Textarea
                id="descriptionAr"
                value={formData.descriptionAr}
                onChange={(e) =>
                  setFormData({ ...formData, descriptionAr: e.target.value })
                }
                placeholder="وصف تفصيلي للوجبة بالعربي"
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="descriptionEn" className="ltr">
                Description (EN)
              </Label>
              <Textarea
                id="descriptionEn"
                value={formData.descriptionEn}
                onChange={(e) =>
                  setFormData({ ...formData, descriptionEn: e.target.value })
                }
                placeholder="Detailed description in English"
                className="ltr"
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="imageUrl" className="ltr">
                Image URL
              </Label>
              <Input
                id="imageUrl"
                value={formData.imageUrl}
                onChange={(e) =>
                  setFormData({ ...formData, imageUrl: e.target.value })
                }
                placeholder="https://example.com/image.jpg"
                className="ltr"
              />
              {formData.imageUrl && (
                <div className="mt-2 rounded-lg overflow-hidden border border-[#E9ECEF]">
                  <img
                    src={formData.imageUrl}
                    alt="Preview"
                    className="w-full h-48 object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="extraFeeHalala" className="ltr">
                  Extra Fee (Halala)
                </Label>
                <Input
                  id="extraFeeHalala"
                  type="number"
                  value={formData.extraFeeHalala}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      extraFeeHalala: Number(e.target.value),
                    })
                  }
                  placeholder="3500"
                  className="ltr"
                />
                <p className="text-xs text-[#6C757D]">
                  {formatPrice(formData.extraFeeHalala)} =
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="sortOrder" className="ltr">
                  Sort Order
                </Label>
                <Input
                  id="sortOrder"
                  type="number"
                  value={formData.sortOrder}
                  onChange={(e) =>
                    setFormData({ ...formData, sortOrder: Number(e.target.value) })
                  }
                  className="ltr"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-4">
              <div>
                <Label className="ltr">Is Active</Label>
                <p className="text-sm text-[#6C757D] mt-1">
                  تفعيل أو تعطيل الوجبة المميزة
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
